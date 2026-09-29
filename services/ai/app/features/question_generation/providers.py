import json

import httpx

from app.features.question_generation.output_validator import InvalidAiOutputError
from app.features.question_generation.prompt import (
    SYSTEM_INSTRUCTION,
    read_evidence,
    response_schema_for,
)
from app.features.question_generation.provider_config import (
    CONNECT_TIMEOUT_SECONDS,
    READ_TIMEOUT_SECONDS,
    GeminiConfig,
    load_gemini_config,
)

MIN_EVIDENCE_CHARS = 40

_BLOCKING_FINISH_REASONS = frozenset({"SAFETY", "RECITATION", "LANGUAGE", "PROHIBITED_CONTENT", "BLOCKLIST", "IMAGE_SAFETY"})
_ANSWER_FIELDS = ("options", "correctOptionId", "referenceAnswer")


class InsufficientEvidenceError(Exception):
    """Raised when the transcript evidence cannot support a grounded question."""


class ProviderCallError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = True) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


# ============================================================
# deterministic offline provider
# ============================================================

class DeterministicQuestionProvider:
    """Satisfies the LlmProvider protocol without network access or an API key."""

    async def generate(self, prompt: str) -> str:
        evidence = read_evidence(prompt)
        cues = evidence["cues"]
        joined = " ".join(cue["text"].strip() for cue in cues).strip()
        if len(joined) < MIN_EVIDENCE_CHARS:
            raise InsufficientEvidenceError("transcript evidence is too short for a grounded question")

        anchor = cues[0]
        if evidence["questionType"] == "multipleChoice":
            question = {
                "type": "multipleChoice",
                "prompt": f"Theo transcript, ý chính của đoạn '{_shorten(anchor['text'])}' là gì?",
                "options": [
                    {"optionId": "option-a", "text": _shorten(anchor["text"])},
                    {"optionId": "option-b", "text": "Một chi tiết không xuất hiện trong đoạn học"},
                    {"optionId": "option-c", "text": "Một kết luận không có bằng chứng trong transcript"},
                ],
                "correctOptionId": "option-a",
                "sourceStartMs": anchor["startMs"],
                "sourceEndMs": anchor["endMs"],
            }
        else:
            question = {
                "type": "shortAnswer",
                "prompt": "Hãy tóm tắt ý chính của đoạn transcript bằng lời của bạn.",
                "referenceAnswer": _shorten(joined, limit=240),
                "sourceStartMs": anchor["startMs"],
                "sourceEndMs": cues[-1]["endMs"],
            }

        return json.dumps({"questions": [question]}, ensure_ascii=False)


def _shorten(value: str, limit: int = 120) -> str:
    text = " ".join(value.split())
    return text if len(text) <= limit else f"{text[: limit - 1].rstrip()}…"


# ============================================================
# gemini provider
# ============================================================

class GeminiQuestionProvider:
    """Calls the Gemini generateContent REST endpoint. The API key never leaves this service."""

    def __init__(
        self,
        config: GeminiConfig | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        read_timeout: float = READ_TIMEOUT_SECONDS,
    ) -> None:
        self._config = config or load_gemini_config()
        self._transport = transport
        self._timeout = httpx.Timeout(read_timeout, connect=CONNECT_TIMEOUT_SECONDS)

    async def generate(self, prompt: str) -> str:
        evidence = read_evidence(prompt)
        joined = " ".join(cue["text"].strip() for cue in evidence["cues"]).strip()
        if len(joined) < MIN_EVIDENCE_CHARS:
            raise InsufficientEvidenceError("transcript evidence is too short for a grounded question")

        payload = self._build_payload(prompt, evidence["questionType"])
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=self._timeout) as client:
                response = await client.post(
                    self._config.generate_url,
                    headers={"x-goog-api-key": self._config.api_key, "Content-Type": "application/json"},
                    json=payload,
                )
        except httpx.TimeoutException as error:
            raise ProviderCallError("providerTimeout", "The question provider did not answer in time.") from error
        except httpx.HTTPError as error:
            raise ProviderCallError("providerFailed", "The question provider could not be reached.") from error

        _raise_for_status(response.status_code)
        return _read_candidate_text(response.json())

    def _build_payload(self, prompt: str, question_type: str) -> dict:
        return {
            "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": response_schema_for(question_type),
                "temperature": self._config.temperature,
                "maxOutputTokens": self._config.max_output_tokens,
                "candidateCount": 1,
            },
        }


# ============================================================
# gemini response reading
# ============================================================

def _raise_for_status(status_code: int) -> None:
    if status_code == 200:
        return
    if status_code in {400, 401, 403, 404}:
        raise ProviderCallError("providerNotConfigured", "The question provider rejected the service credentials.")
    raise ProviderCallError("providerFailed", "The question provider returned an error.")


def _read_candidate_text(body: dict) -> str:
    block_reason = (body.get("promptFeedback") or {}).get("blockReason")
    if block_reason:
        raise ProviderCallError("providerBlockedContent", "The provider blocked this transcript segment.", retryable=False)

    candidates = body.get("candidates") or []
    if not candidates:
        raise ProviderCallError("providerFailed", "The question provider returned no candidate.")

    candidate = candidates[0]
    finish_reason = candidate.get("finishReason")
    if finish_reason in _BLOCKING_FINISH_REASONS:
        raise ProviderCallError("providerBlockedContent", "The provider blocked the generated question.", retryable=False)
    if finish_reason == "MAX_TOKENS":
        raise InvalidAiOutputError("invalidAiOutputJson", "The provider answer was cut off before valid JSON.")

    parts = (candidate.get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise InvalidAiOutputError("invalidAiOutputJson", "The provider returned an empty answer.")
    return _normalize_json_text(text)


def _normalize_json_text(text: str) -> str:
    """Unwraps a markdown fence and drops empty answer fields, then leaves judgement to the validator."""
    unwrapped = _strip_code_fence(text)
    try:
        payload = json.loads(unwrapped)
    except json.JSONDecodeError:
        return unwrapped
    if not isinstance(payload, dict):
        return unwrapped

    questions = payload.get("questions")
    if isinstance(questions, list):
        payload["questions"] = [_prune_empty_answer_fields(item) for item in questions]
    return json.dumps(payload, ensure_ascii=False)


def _strip_code_fence(text: str) -> str:
    if not text.startswith("```"):
        return text
    body = text[3:]
    if body.lower().startswith("json"):
        body = body[4:]
    return body.rsplit("```", 1)[0].strip() if "```" in body else body.strip()


def _prune_empty_answer_fields(item: object) -> object:
    if not isinstance(item, dict):
        return item
    return {key: value for key, value in item.items() if not (key in _ANSWER_FIELDS and value in (None, "", []))}
