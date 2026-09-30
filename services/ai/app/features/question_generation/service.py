import asyncio

from app.features.question_generation.output_validator import InvalidAiOutputError, validate_output
from app.features.question_generation.prompt import build_prompt
from app.features.question_generation.providers import DeterministicQuestionProvider, InsufficientEvidenceError, ProviderCallError
from app.features.question_generation.schemas import QuestionGenerationRequest, QuestionGenerationResponse
from app.platform.config import settings
from app.platform.llm.gemini_provider import GeminiConfigurationError, GeminiJsonProvider
from app.platform.llm.provider import LlmProvider

MAX_CHUNK_CHARS = 12_000


class ProviderUnavailableError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = True) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class InsufficientEvidenceRejected(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.code = "transcriptInsufficient"
        self.message = message


def resolve_provider() -> LlmProvider:
    if settings.llm_provider == "fake":
        return DeterministicQuestionProvider()
    if settings.llm_provider == "gemini":
        try:
            return GeminiJsonProvider(QuestionGenerationResponse.model_json_schema())
        except GeminiConfigurationError as error:
            raise ProviderUnavailableError("providerNotConfigured", str(error), retryable=False) from error
    raise ProviderUnavailableError(
        "providerNotConfigured",
        f"LLM provider '{settings.llm_provider}' is not wired for question generation yet.",
    )


class QuestionGenerationService:
    def __init__(self, provider: LlmProvider | None = None, timeout_seconds: float | None = None) -> None:
        self._provider = provider
        self._timeout_seconds = timeout_seconds if timeout_seconds is not None else settings.quiz_timeout_seconds

    async def generate(self, request: QuestionGenerationRequest) -> QuestionGenerationResponse:
        provider = self._provider or resolve_provider()
        questions = []
        try:
            for chunk in _chunk_request(request):
                raw = await asyncio.wait_for(provider.generate(build_prompt(chunk)), timeout=self._timeout_seconds)
                questions.extend(validate_output(raw, chunk).questions)
        except asyncio.TimeoutError as error:
            raise ProviderUnavailableError("providerTimeout", "The question provider did not answer in time.") from error
        except InsufficientEvidenceError as error:
            raise InsufficientEvidenceRejected(str(error)) from error
        except ProviderCallError as error:
            raise ProviderUnavailableError(error.code, error.message, error.retryable) from error
        except InvalidAiOutputError:
            raise
        except Exception as error:  # noqa: BLE001 - provider details must not cross the API boundary
            raise ProviderUnavailableError("providerFailed", "The question provider failed.") from error

        unique = []
        seen: set[str] = set()
        for question in questions:
            key = " ".join(question.prompt.casefold().split())
            if key not in seen:
                seen.add(key)
                unique.append(question)
            if len(unique) >= request.questionCount:
                break
        if not unique:
            raise InvalidAiOutputError("invalidAiOutput", "The provider returned no usable question.")
        return QuestionGenerationResponse(questions=unique)


def _chunk_request(request: QuestionGenerationRequest) -> list[QuestionGenerationRequest]:
    chunks: list[list] = []
    current: list = []
    current_chars = 0
    for cue in request.cues:
        if current and current_chars + len(cue.text) > MAX_CHUNK_CHARS:
            chunks.append(current)
            current = []
            current_chars = 0
        current.append(cue)
        current_chars += len(cue.text)
    if current:
        chunks.append(current)
    if len(chunks) == 1:
        return [request]

    results: list[QuestionGenerationRequest] = []
    for cues in chunks:
        chunk_count = max(1, round(request.questionCount * len(cues) / len(request.cues)))
        # The public schema requires at least three questions. Internal chunks
        # may over-generate; the merged output below is deduplicated and capped.
        results.append(request.model_copy(update={
            "startMs": cues[0].startMs,
            "endMs": cues[-1].endMs,
            "questionCount": max(3, chunk_count),
            "cues": cues,
        }))
    return results
