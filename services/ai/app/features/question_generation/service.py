import asyncio

from app.features.question_generation.output_validator import InvalidAiOutputError, validate_output
from app.features.question_generation.prompt import build_prompt
from app.features.question_generation.provider_config import ProviderConfigError
from app.features.question_generation.providers import (
    DeterministicQuestionProvider,
    GeminiQuestionProvider,
    InsufficientEvidenceError,
    ProviderCallError,
)
from app.features.question_generation.schemas import QuestionGenerationRequest, QuestionGenerationResponse
from app.platform.config import settings
from app.platform.llm.provider import LlmProvider

PROVIDER_TIMEOUT_SECONDS = 3.0
GEMINI_TIMEOUT_SECONDS = 22.0


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


# ============================================================
# provider selection
# ============================================================

def resolve_provider() -> LlmProvider:
    if settings.llm_provider == "fake":
        return DeterministicQuestionProvider()
    if settings.llm_provider == "gemini":
        try:
            return GeminiQuestionProvider()
        except ProviderConfigError as error:
            raise ProviderUnavailableError(
                "providerNotConfigured",
                "The gemini provider is missing its server-side credentials.",
            ) from error
    raise ProviderUnavailableError(
        "providerNotConfigured",
        f"LLM provider '{settings.llm_provider}' is not wired for question generation yet.",
    )


def timeout_for(provider: LlmProvider) -> float:
    """A real provider needs room to answer; the offline provider must stay instant."""
    return GEMINI_TIMEOUT_SECONDS if isinstance(provider, GeminiQuestionProvider) else PROVIDER_TIMEOUT_SECONDS


# ============================================================
# use case
# ============================================================

class QuestionGenerationService:
    def __init__(self, provider: LlmProvider | None = None, timeout_seconds: float | None = None) -> None:
        self._provider = provider
        self._timeout_seconds = timeout_seconds

    async def generate(self, request: QuestionGenerationRequest) -> QuestionGenerationResponse:
        provider = self._provider or resolve_provider()
        timeout_seconds = self._timeout_seconds or timeout_for(provider)
        prompt = build_prompt(request)

        try:
            raw = await asyncio.wait_for(provider.generate(prompt), timeout=timeout_seconds)
        except asyncio.TimeoutError as error:
            raise ProviderUnavailableError("providerTimeout", "The question provider did not answer in time.") from error
        except InsufficientEvidenceError as error:
            raise InsufficientEvidenceRejected(str(error)) from error
        except ProviderCallError as error:
            raise ProviderUnavailableError(error.code, error.message, error.retryable) from error
        except InvalidAiOutputError:
            raise
        except Exception as error:  # noqa: BLE001 - any provider fault stays retryable for the Backend
            raise ProviderUnavailableError("providerFailed", "The question provider failed.") from error

        return validate_output(raw, request)
