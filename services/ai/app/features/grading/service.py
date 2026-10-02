import asyncio

from pydantic import ValidationError

from app.features.grading.prompt import build_prompt
from app.features.grading.providers import DeterministicGradingProvider
from app.features.grading.schemas import (
    ShortAnswerGradeDecision,
    ShortAnswerGradeRequest,
    ShortAnswerGradeResponse,
)
from app.platform.config import settings
from app.platform.llm.gemini_provider import GeminiConfigurationError, GeminiJsonProvider
from app.platform.llm.provider import LlmProvider, LlmProviderError


class GradingProviderUnavailableError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = True) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class InvalidGradeOutputError(Exception):
    def __init__(self, message: str = "The grading provider returned an invalid result.") -> None:
        super().__init__(message)
        self.code = "invalidAiGrade"
        self.message = message


def resolve_provider() -> LlmProvider:
    if settings.llm_provider == "fake":
        return DeterministicGradingProvider()
    if settings.llm_provider == "gemini":
        try:
            return GeminiJsonProvider(ShortAnswerGradeDecision)
        except GeminiConfigurationError as error:
            raise GradingProviderUnavailableError("providerNotConfigured", str(error), False) from error
    raise GradingProviderUnavailableError(
        "providerNotConfigured",
        f"LLM provider '{settings.llm_provider}' is not wired for grading yet.",
        False,
    )


class ShortAnswerGradingService:
    def __init__(self, provider: LlmProvider | None = None, timeout_seconds: float | None = None) -> None:
        self._provider = provider
        self._timeout_seconds = timeout_seconds if timeout_seconds is not None else settings.grading_timeout_seconds

    async def grade(self, request: ShortAnswerGradeRequest) -> ShortAnswerGradeResponse:
        provider = self._provider or resolve_provider()
        try:
            raw = await asyncio.wait_for(provider.generate(build_prompt(request)), timeout=self._timeout_seconds)
        except asyncio.TimeoutError as error:
            raise GradingProviderUnavailableError("providerTimeout", "The grading provider did not answer in time.") from error
        except LlmProviderError as error:
            raise GradingProviderUnavailableError(error.code, error.message, error.retryable) from error
        except GradingProviderUnavailableError:
            raise
        except Exception as error:  # noqa: BLE001 - provider details must not cross the API boundary
            raise GradingProviderUnavailableError("providerFailed", "The grading provider failed.") from error

        try:
            decision = ShortAnswerGradeDecision.model_validate_json(raw)
        except (ValidationError, ValueError) as error:
            raise InvalidGradeOutputError() from error

        return ShortAnswerGradeResponse(
            outcome=decision.outcome,
            score=decision.score,
            referenceAnswer=request.referenceAnswer,
            explanation=decision.explanation.strip(),
        )
