import asyncio
import re

from app.features.question_generation.output_validator import InvalidAiOutputError, validate_chunk_output
from app.features.question_generation.prompt import MAX_EVIDENCE_CHARS, build_prompt
from app.features.question_generation.providers import DeterministicQuestionProvider, InsufficientEvidenceError, ProviderCallError
from app.features.question_generation.schemas import (
    GeneratedQuestion,
    ProviderQuestionGenerationChunkResponse,
    QuestionGenerationRequest,
    QuestionGenerationResponse,
)
from app.platform.config import settings
from app.platform.llm.gemini_provider import GeminiConfigurationError, GeminiJsonProvider
from app.platform.llm.provider import LlmProvider

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
            return GeminiJsonProvider(ProviderQuestionGenerationChunkResponse)
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
        questions: list[GeneratedQuestion] = []
        last_insufficient_error: InsufficientEvidenceError | None = None
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._timeout_seconds
        try:
            for chunk in _chunk_request(request):
                try:
                    remaining_seconds = deadline - loop.time()
                    if remaining_seconds <= 0:
                        raise asyncio.TimeoutError
                    raw = await asyncio.wait_for(
                        provider.generate(build_prompt(chunk)),
                        timeout=remaining_seconds,
                    )
                except InsufficientEvidenceError as error:
                    last_insufficient_error = error
                    continue
                questions.extend(validate_chunk_output(raw, chunk))
        except asyncio.TimeoutError as error:
            raise ProviderUnavailableError("providerTimeout", "The question provider did not answer in time.") from error
        except ProviderCallError as error:
            raise ProviderUnavailableError(error.code, error.message, error.retryable) from error
        except InvalidAiOutputError:
            raise
        except Exception as error:  # noqa: BLE001 - provider details must not cross the API boundary
            raise ProviderUnavailableError("providerFailed", "The question provider failed.") from error

        relevant = [question for question in questions if _is_main_topic_candidate(question, request)]
        unique: list[GeneratedQuestion] = []
        seen: set[str] = set()
        for question in relevant:
            key = " ".join(question.prompt.casefold().split())
            if key not in seen:
                seen.add(key)
                unique.append(question)
        if not unique:
            if last_insufficient_error is not None:
                raise InsufficientEvidenceRejected(str(last_insufficient_error)) from last_insufficient_error
            raise InvalidAiOutputError("invalidAiOutput", "The provider returned no usable question.")
        return QuestionGenerationResponse(questions=_select_across_timeline(unique, request))


_TEMPORAL_TRIVIA = re.compile(
    r"\b(?:năm|ngày|tháng)\s+(?:nào|bao\s+nhiêu)\b|\b(?:what|which)\s+(?:year|date)\b",
    re.IGNORECASE,
)
_EXPERIMENT_DETAIL = re.compile(
    r"\b(?:nghiên\s+cứu|thí\s+nghiệm|study|experiment)\b.*"
    r"\b(?:nhóm|người\s+tham\s+gia|participant|group|exact|chính\s+xác|phần\s+trăm|percentage|kết\s+quả)\b",
    re.IGNORECASE,
)
_TEMPORAL_TOPIC = re.compile(r"\b(?:lịch\s+sử|niên\s+biểu|tiểu\s+sử|history|timeline|chronology|biography)\b", re.IGNORECASE)
_RESEARCH_TOPIC = re.compile(r"\b(?:nghiên\s+cứu|thí\s+nghiệm|research|experiment)\b", re.IGNORECASE)


def _is_main_topic_candidate(question: GeneratedQuestion, request: QuestionGenerationRequest) -> bool:
    """Drop obvious peripheral trivia without asking the provider for another pass."""
    prompt = " ".join(question.prompt.split())
    title = " ".join(request.videoTitle.split())
    if _TEMPORAL_TRIVIA.search(prompt) and not _TEMPORAL_TOPIC.search(title):
        return False
    if _EXPERIMENT_DETAIL.search(prompt) and not _RESEARCH_TOPIC.search(title):
        return False
    return True


def _select_across_timeline(questions: list[GeneratedQuestion], request: QuestionGenerationRequest) -> list[GeneratedQuestion]:
    ordered = sorted(questions, key=lambda item: (item.sourceStartMs, item.sourceEndMs))
    if len(ordered) <= request.questionCount:
        return ordered

    selected: set[int] = set()
    for position in range(request.questionCount):
        target_ms = request.startMs + (request.endMs - request.startMs) * position / (request.questionCount - 1)
        nearest = min(
            (index for index in range(len(ordered)) if index not in selected),
            key=lambda index: (abs(ordered[index].sourceStartMs - target_ms), index),
        )
        selected.add(nearest)
    return [ordered[index] for index in sorted(selected)]


def _chunk_request(request: QuestionGenerationRequest) -> list[QuestionGenerationRequest]:
    chunks: list[list] = []
    current: list = []
    current_chars = 0
    for cue in request.cues:
        if current and current_chars + len(cue.text) > MAX_EVIDENCE_CHARS:
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
            "startMs": min(cue.startMs for cue in cues),
            "endMs": max(cue.endMs for cue in cues),
            "questionCount": max(3, chunk_count),
            "cues": cues,
        }))
    return results
