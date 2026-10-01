import asyncio
import json

import pytest

from app.features.question_generation.output_validator import InvalidAiOutputError
from app.features.question_generation.prompt import PROMPT_VERSION, build_prompt, read_evidence
from app.features.question_generation.schemas import QuestionGenerationChunkResponse, QuestionGenerationRequest
from app.features.question_generation.service import (
    InsufficientEvidenceRejected,
    ProviderUnavailableError,
    QuestionGenerationService,
    _chunk_request,
    resolve_provider,
)

LONG_CUE = "TCP chia dữ liệu thành các segment có thứ tự và truyền lại phần bị mất."


# ============================================================
# helpers
# ============================================================

def request_for(question_type: str = "multipleChoice", text: str = LONG_CUE) -> QuestionGenerationRequest:
    return QuestionGenerationRequest(
        contractVersion="0.5.0",
        promptVersion="0.5.0",
        sessionId="11111111-1111-4111-8111-111111111111",
        transcriptCaptureId="22222222-2222-4222-8222-222222222222",
        youtubeVideoId="dQw4w9WgXcQ",
        startMs=0,
        endMs=300_000,
        questionCount=3,
        questionType=question_type,
        difficulty="medium",
        cues=[{"startMs": 0, "endMs": 30_000, "text": text}],
    )


class StubProvider:
    def __init__(self, payload: str = "", delay: float = 0.0, error: Exception | None = None) -> None:
        self.payload = payload
        self.delay = delay
        self.error = error
        self.prompts: list[str] = []

    async def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return self.payload


# ============================================================
# deterministic happy paths
# ============================================================

def test_generates_a_grounded_multiple_choice_question() -> None:
    response = asyncio.run(QuestionGenerationService().generate(request_for()))
    question = response.questions[0]

    assert question.type == "multipleChoice"
    assert question.options is not None and len(question.options) >= 3
    assert question.correctOptionId in {option.optionId for option in question.options}
    assert question.sourceStartMs >= 0 and question.sourceEndMs <= 300_000
    assert question.referenceAnswer is None


def test_generates_a_grounded_short_answer_question() -> None:
    response = asyncio.run(QuestionGenerationService().generate(request_for("shortAnswer")))
    question = response.questions[0]

    assert question.type == "shortAnswer"
    assert question.referenceAnswer and question.referenceAnswer in LONG_CUE
    assert question.options is None


def test_prompt_carries_versioned_evidence_only_from_the_request() -> None:
    provider = StubProvider(payload='{"questions": []}')
    service = QuestionGenerationService(provider=provider)

    with pytest.raises(InvalidAiOutputError):
        asyncio.run(service.generate(request_for()))

    prompt = provider.prompts[0]
    evidence = read_evidence(prompt)
    assert f"promptVersion: {PROMPT_VERSION}" in prompt
    assert evidence["cues"] == [{"startMs": 0, "endMs": 30_000, "text": LONG_CUE}]
    assert evidence["startMs"] == 0 and evidence["endMs"] == 300_000


def test_build_prompt_forbids_outside_knowledge() -> None:
    prompt = build_prompt(request_for())
    assert "Use only the transcript evidence" in prompt


# ============================================================
# failures
# ============================================================

def test_short_transcript_is_rejected_without_inventing_content() -> None:
    with pytest.raises(InsufficientEvidenceRejected) as error:
        asyncio.run(QuestionGenerationService().generate(request_for(text="Quá ngắn.")))

    assert error.value.code == "transcriptInsufficient"


def test_provider_timeout_is_a_retryable_provider_failure() -> None:
    service = QuestionGenerationService(provider=StubProvider(payload="{}", delay=0.05), timeout_seconds=0.01)

    with pytest.raises(ProviderUnavailableError) as error:
        asyncio.run(service.generate(request_for()))

    assert error.value.code == "providerTimeout"


def test_provider_crash_is_a_retryable_provider_failure() -> None:
    service = QuestionGenerationService(provider=StubProvider(error=RuntimeError("socket closed")))

    with pytest.raises(ProviderUnavailableError) as error:
        asyncio.run(service.generate(request_for()))

    assert error.value.code == "providerFailed"


def test_malformed_provider_output_is_not_masked_as_a_provider_outage() -> None:
    service = QuestionGenerationService(provider=StubProvider(payload="{not json"))

    with pytest.raises(InvalidAiOutputError) as error:
        asyncio.run(service.generate(request_for()))

    assert error.value.code == "invalidAiOutputJson"


def test_unknown_configured_provider_is_reported_instead_of_silently_faking(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.features.question_generation.service.settings.llm_provider", "vllm")

    with pytest.raises(ProviderUnavailableError) as error:
        resolve_provider()

    assert error.value.code == "providerNotConfigured"
    assert error.value.retryable is True


def test_ordinary_full_video_transcript_uses_one_provider_call() -> None:
    body = request_for().model_dump()
    body["cues"] = [
        {"startMs": 0, "endMs": 30_000, "text": "x" * 7_100},
        {"startMs": 30_000, "endMs": 60_000, "text": "y" * 7_100},
    ]
    request = QuestionGenerationRequest.model_validate(body)

    assert len(_chunk_request(request)) == 1


def test_very_long_transcript_is_still_split() -> None:
    body = request_for().model_dump()
    body["cues"] = [
        {"startMs": 0, "endMs": 30_000, "text": "x" * 13_000},
        {"startMs": 30_000, "endMs": 60_000, "text": "y" * 13_000},
    ]
    request = QuestionGenerationRequest.model_validate(body)

    assert len(_chunk_request(request)) == 2


def test_returns_fewer_questions_when_evidence_only_supports_one() -> None:
    body = request_for("shortAnswer").model_dump()
    body["questionCount"] = 5
    request = QuestionGenerationRequest.model_validate(body)
    provider = StubProvider(payload=json.dumps({"questions": [{
        "type": "shortAnswer",
        "prompt": "What is explained in the transcript?",
        "referenceAnswer": "TCP segments",
        "explanation": "The cited cue discusses TCP segments.",
        "sourceStartMs": 0,
        "sourceEndMs": 30_000,
    }]}))

    result = asyncio.run(QuestionGenerationService(provider=provider).generate(request))

    assert len(result.questions) == 1
    assert read_evidence(provider.prompts[0])["questionCount"] == 5


def test_empty_evidence_chunk_does_not_discard_valid_questions_from_other_chunks() -> None:
    body = request_for("shortAnswer").model_dump()
    body["endMs"] = 900_000
    body["questionCount"] = 5
    body["cues"] = [
        {"startMs": 0, "endMs": 30_000, "text": "Useful evidence " + "x" * 13_000},
        {"startMs": 600_000, "endMs": 630_000, "text": "No question here " + "y" * 13_000},
    ]
    request = QuestionGenerationRequest.model_validate(body)

    class PartialProvider:
        async def generate(self, prompt: str) -> str:
            cue = read_evidence(prompt)["cues"][0]
            if cue["startMs"] > 0:
                return '{"questions": []}'
            return json.dumps({"questions": [{
                "type": "shortAnswer",
                "prompt": "What does the first cue explain?",
                "referenceAnswer": "Useful evidence",
                "explanation": "The first cue supplies the evidence.",
                "sourceStartMs": 0,
                "sourceEndMs": 30_000,
            }]})

    assert QuestionGenerationChunkResponse.model_validate({"questions": []}).questions == []
    result = asyncio.run(QuestionGenerationService(provider=PartialProvider()).generate(request))

    assert len(result.questions) == 1
    assert result.questions[0].sourceStartMs == 0


def test_long_video_keeps_all_chunk_evidence_and_questions_across_timeline() -> None:
    body = request_for("shortAnswer").model_dump()
    body["endMs"] = 3_600_000
    body["questionCount"] = 15
    body["cues"] = [
        {"startMs": index * 600_000, "endMs": index * 600_000 + 30_000, "text": f"Part {index}: " + "x" * 13_000}
        for index in range(6)
    ]
    request = QuestionGenerationRequest.model_validate(body)

    class PerChunkProvider:
        def __init__(self) -> None:
            self.prompts: list[str] = []

        async def generate(self, prompt: str) -> str:
            self.prompts.append(prompt)
            cue = read_evidence(prompt)["cues"][0]
            return json.dumps({"questions": [{
                "type": "shortAnswer",
                "prompt": f"Question at {cue['startMs']} variant {variant}",
                "referenceAnswer": f"Part at {cue['startMs']}",
                "explanation": "The cited cue supports this answer.",
                "sourceStartMs": cue["startMs"],
                "sourceEndMs": cue["endMs"],
            } for variant in range(3)]})

    provider = PerChunkProvider()
    result = asyncio.run(QuestionGenerationService(provider=provider).generate(request))

    assert len(provider.prompts) == 6
    assert [cue["text"] for prompt in provider.prompts for cue in read_evidence(prompt)["cues"]] == [
        cue.text for cue in request.cues
    ]
    assert len(result.questions) == 15
    assert result.questions[0].sourceStartMs == 0
    assert result.questions[-1].sourceStartMs == 3_000_000
