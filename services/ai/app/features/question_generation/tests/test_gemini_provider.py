import asyncio
import json

import httpx
import pytest

from app.features.question_generation.output_validator import InvalidAiOutputError
from app.features.question_generation.prompt import build_prompt, response_schema_for
from app.features.question_generation.provider_config import GeminiConfig
from app.features.question_generation.providers import (
    DeterministicQuestionProvider,
    GeminiQuestionProvider,
    InsufficientEvidenceError,
    ProviderCallError,
)
from app.features.question_generation.schemas import QuestionGenerationRequest
from app.features.question_generation.service import (
    GEMINI_TIMEOUT_SECONDS,
    PROVIDER_TIMEOUT_SECONDS,
    ProviderUnavailableError,
    QuestionGenerationService,
    resolve_provider,
    timeout_for,
)

API_KEY = "test-only-key-not-a-secret"
LONG_CUE = "TCP chia dữ liệu thành các segment có thứ tự và truyền lại phần bị mất."


# ============================================================
# helpers
# ============================================================

def request_for(question_type: str = "multipleChoice", text: str = LONG_CUE) -> QuestionGenerationRequest:
    return QuestionGenerationRequest(
        contractVersion="0.4.0",
        promptVersion="0.4.0",
        segmentId="11111111-1111-4111-8111-111111111111",
        youtubeVideoId="dQw4w9WgXcQ",
        startMs=0,
        endMs=300_000,
        questionType=question_type,
        difficulty="medium",
        cues=[{"startMs": 0, "endMs": 30_000, "text": text}],
    )


def config_for_tests() -> GeminiConfig:
    return GeminiConfig(
        api_key=API_KEY,
        model="gemini-3.8-flash",
        base_url="https://generativelanguage.example.invalid/v1beta",
        temperature=0.2,
        max_output_tokens=1024,
    )


def provider_with(handler, read_timeout: float = 1.0) -> GeminiQuestionProvider:
    return GeminiQuestionProvider(
        config=config_for_tests(),
        transport=httpx.MockTransport(handler),
        read_timeout=read_timeout,
    )


def answering(text: str, finish_reason: str = "STOP", status_code: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code,
            json={"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": finish_reason}]},
        )

    return handler


def replying(body: dict, status_code: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json=body)

    return handler


MCQ_ANSWER = json.dumps(
    {
        "questions": [
            {
                "type": "multipleChoice",
                "prompt": "Theo transcript, TCP xử lý phần dữ liệu bị mất như thế nào?",
                "options": [
                    {"optionId": "a", "text": "Truyền lại phần bị mất"},
                    {"optionId": "b", "text": "Bỏ qua phần bị mất"},
                    {"optionId": "c", "text": "Đổi sang giao thức khác"},
                ],
                "correctOptionId": "a",
                "referenceAnswer": "",
                "sourceStartMs": 0,
                "sourceEndMs": 30_000,
            }
        ]
    },
    ensure_ascii=False,
)

SHORT_ANSWER = json.dumps(
    {
        "questions": [
            {
                "type": "shortAnswer",
                "prompt": "Hãy giải thích cách TCP bảo đảm thứ tự dữ liệu.",
                "referenceAnswer": "TCP chia dữ liệu thành các segment có thứ tự và truyền lại phần bị mất.",
                "sourceStartMs": 0,
                "sourceEndMs": 30_000,
            }
        ]
    },
    ensure_ascii=False,
)


def generate_through_service(handler, question_type: str = "multipleChoice"):
    service = QuestionGenerationService(provider=provider_with(handler))
    return asyncio.run(service.generate(request_for(question_type)))


# ============================================================
# happy paths
# ============================================================

def test_multiple_choice_answer_from_the_real_provider_reaches_the_contract_response() -> None:
    response = generate_through_service(answering(MCQ_ANSWER))
    question = response.questions[0]

    assert question.type == "multipleChoice"
    assert question.options is not None and len(question.options) == 3
    assert question.correctOptionId == "a"
    assert question.referenceAnswer is None
    assert question.sourceEndMs <= 300_000


def test_short_answer_from_the_real_provider_keeps_its_reference_answer() -> None:
    response = generate_through_service(answering(SHORT_ANSWER), "shortAnswer")
    question = response.questions[0]

    assert question.type == "shortAnswer"
    assert question.referenceAnswer
    assert question.options is None


def test_markdown_fenced_json_is_still_accepted() -> None:
    response = generate_through_service(answering(f"```json\n{MCQ_ANSWER}\n```"))
    assert response.questions[0].correctOptionId == "a"


# ============================================================
# provider output failures
# ============================================================

def test_prose_instead_of_json_is_an_invalid_output_not_an_outage() -> None:
    with pytest.raises(InvalidAiOutputError) as error:
        generate_through_service(answering("Sure! Here is a question about TCP."))

    assert error.value.code == "invalidAiOutputJson"


def test_truncated_answer_is_reported_as_invalid_json() -> None:
    with pytest.raises(InvalidAiOutputError) as error:
        generate_through_service(answering('{"questions": [', finish_reason="MAX_TOKENS"))

    assert error.value.code == "invalidAiOutputJson"


def test_empty_candidate_text_is_reported_as_invalid_json() -> None:
    with pytest.raises(InvalidAiOutputError) as error:
        generate_through_service(answering("   "))

    assert error.value.code == "invalidAiOutputJson"


def test_source_range_outside_the_segment_is_still_rejected_for_a_real_provider() -> None:
    payload = json.dumps(
        {
            "questions": [
                {
                    "type": "shortAnswer",
                    "prompt": "Câu hỏi ngoài phạm vi.",
                    "referenceAnswer": "Ngoài phạm vi.",
                    "sourceStartMs": 0,
                    "sourceEndMs": 900_000,
                }
            ]
        },
        ensure_ascii=False,
    )

    with pytest.raises(InvalidAiOutputError) as error:
        generate_through_service(answering(payload), "shortAnswer")

    assert error.value.code == "invalidAiOutputTimestamp"


# ============================================================
# provider transport failures
# ============================================================

def test_blocked_generation_is_not_retryable() -> None:
    with pytest.raises(ProviderUnavailableError) as error:
        generate_through_service(answering(MCQ_ANSWER, finish_reason="SAFETY"))

    assert error.value.code == "providerBlockedContent"
    assert error.value.retryable is False


def test_blocked_prompt_without_candidates_is_not_retryable() -> None:
    with pytest.raises(ProviderUnavailableError) as error:
        generate_through_service(replying({"promptFeedback": {"blockReason": "SAFETY"}}))

    assert error.value.code == "providerBlockedContent"
    assert error.value.retryable is False


def test_response_without_candidates_is_a_retryable_provider_failure() -> None:
    with pytest.raises(ProviderUnavailableError) as error:
        generate_through_service(replying({"candidates": []}))

    assert error.value.code == "providerFailed"
    assert error.value.retryable is True


@pytest.mark.parametrize("status_code", [429, 500, 502, 503])
def test_provider_outage_status_codes_stay_retryable(status_code: int) -> None:
    with pytest.raises(ProviderUnavailableError) as error:
        generate_through_service(replying({"error": {"message": "unavailable"}}, status_code))

    assert error.value.code == "providerFailed"
    assert error.value.retryable is True


@pytest.mark.parametrize("status_code", [400, 401, 403, 404])
def test_credential_and_request_rejections_are_reported_as_misconfiguration(status_code: int) -> None:
    with pytest.raises(ProviderUnavailableError) as error:
        generate_through_service(replying({"error": {"message": "denied"}}, status_code))

    assert error.value.code == "providerNotConfigured"


def test_read_timeout_is_reported_as_a_provider_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("read timed out", request=request)

    with pytest.raises(ProviderUnavailableError) as error:
        generate_through_service(handler)

    assert error.value.code == "providerTimeout"


def test_connection_failure_is_a_retryable_provider_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    with pytest.raises(ProviderUnavailableError) as error:
        generate_through_service(handler)

    assert error.value.code == "providerFailed"


# ============================================================
# request shape and secret safety
# ============================================================

def test_request_forces_json_output_and_carries_the_key_only_in_the_header() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": MCQ_ANSWER}]}, "finishReason": "STOP"}]})

    generate_through_service(handler)
    sent = captured[0]
    body = json.loads(sent.content)

    assert sent.headers["x-goog-api-key"] == API_KEY
    assert "key=" not in str(sent.url)
    assert API_KEY not in sent.content.decode()
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["candidateCount"] == 1
    assert body["systemInstruction"]["parts"][0]["text"].startswith("You are the question generator")
    assert "Use only the transcript evidence" in body["contents"][0]["parts"][0]["text"]


def test_multiple_choice_schema_forbids_a_reference_answer_field() -> None:
    schema = response_schema_for("multipleChoice")["properties"]["questions"]["items"]["properties"]
    assert "referenceAnswer" not in schema
    assert "correctOptionId" in schema

    short_answer = response_schema_for("shortAnswer")["properties"]["questions"]["items"]["properties"]
    assert "options" not in short_answer
    assert "referenceAnswer" in short_answer


def test_no_error_message_leaks_the_api_key() -> None:
    handlers = [
        replying({"error": {"message": f"invalid key {API_KEY}"}}, 403),
        replying({"error": {"message": "quota"}}, 429),
        answering(MCQ_ANSWER, finish_reason="SAFETY"),
    ]

    for handler in handlers:
        with pytest.raises(ProviderUnavailableError) as error:
            generate_through_service(handler)
        assert API_KEY not in error.value.message


# ============================================================
# evidence and wiring
# ============================================================

def test_short_transcript_never_reaches_the_paid_provider() -> None:
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must not run
        raise AssertionError("the provider must not be called for insufficient evidence")

    with pytest.raises(InsufficientEvidenceError):
        asyncio.run(provider_with(handler).generate(build_prompt(request_for(text="Quá ngắn."))))


def test_gemini_is_selected_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.features.question_generation.service.settings.llm_provider", "gemini")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.8-flash")
    monkeypatch.setattr("app.features.question_generation.provider_config.settings.llm_api_key", API_KEY)
    monkeypatch.setattr("app.features.question_generation.provider_config.settings.llm_base_url", "")

    assert isinstance(resolve_provider(), GeminiQuestionProvider)


def test_gemini_without_a_key_is_reported_instead_of_calling_the_api(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.features.question_generation.service.settings.llm_provider", "gemini")
    monkeypatch.setattr("app.features.question_generation.provider_config.settings.llm_api_key", "  ")

    with pytest.raises(ProviderUnavailableError) as error:
        resolve_provider()

    assert error.value.code == "providerNotConfigured"


def test_real_provider_gets_a_longer_timeout_than_the_offline_provider() -> None:
    assert timeout_for(provider_with(answering(MCQ_ANSWER))) == GEMINI_TIMEOUT_SECONDS
    assert timeout_for(DeterministicQuestionProvider()) == PROVIDER_TIMEOUT_SECONDS
    assert GEMINI_TIMEOUT_SECONDS < 25.0
