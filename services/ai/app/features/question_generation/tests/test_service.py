import asyncio

import pytest

from app.features.question_generation.output_validator import InvalidAiOutputError
from app.features.question_generation.prompt import PROMPT_VERSION, build_prompt, read_evidence
from app.features.question_generation.schemas import QuestionGenerationRequest
from app.features.question_generation.service import (
    InsufficientEvidenceRejected,
    ProviderUnavailableError,
    QuestionGenerationService,
    resolve_provider,
)

LONG_CUE = "TCP chia dữ liệu thành các segment có thứ tự và truyền lại phần bị mất."


# ============================================================
# helpers
# ============================================================

def request_for(question_type: str = "multipleChoice", text: str = LONG_CUE) -> QuestionGenerationRequest:
    return QuestionGenerationRequest(
        contractVersion="0.2.0",
        promptVersion="0.2.0",
        segmentId="11111111-1111-4111-8111-111111111111",
        youtubeVideoId="dQw4w9WgXcQ",
        startMs=0,
        endMs=300_000,
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
    monkeypatch.setattr("app.features.question_generation.service.settings.llm_provider", "gemini")

    with pytest.raises(ProviderUnavailableError) as error:
        resolve_provider()

    assert error.value.code == "providerNotConfigured"
