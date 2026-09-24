import asyncio

from app.features.question_generation.output_validator import InvalidAiOutputError, validate_output
from app.features.question_generation.prompt import build_prompt
from app.features.question_generation.providers import DeterministicQuestionProvider, InsufficientEvidenceError
from app.features.question_generation.schemas import QuestionGenerationRequest, QuestionGenerationResponse
from app.platform.config import settings
from app.platform.llm.provider import LlmProvider

PROVIDER_TIMEOUT_SECONDS = 3.0


class ProviderUnavailableError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


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
    raise ProviderUnavailableError(
        "providerNotConfigured",
        f"LLM provider '{settings.llm_provider}' is not wired for question generation yet.",
    )


# ============================================================
# use case
# ============================================================

class QuestionGenerationService:
    def __init__(self, provider: LlmProvider | None = None, timeout_seconds: float = PROVIDER_TIMEOUT_SECONDS) -> None:
        self._provider = provider
        self._timeout_seconds = timeout_seconds

    async def generate(self, request: QuestionGenerationRequest) -> QuestionGenerationResponse:
        provider = self._provider or resolve_provider()
        prompt = build_prompt(request)

        try:
            raw = await asyncio.wait_for(provider.generate(prompt), timeout=self._timeout_seconds)
        except asyncio.TimeoutError as error:
            raise ProviderUnavailableError("providerTimeout", "The question provider did not answer in time.") from error
        except InsufficientEvidenceError as error:
            raise InsufficientEvidenceRejected(str(error)) from error
        except InvalidAiOutputError:
            raise
        except Exception as error:  # noqa: BLE001 - any provider fault stays retryable for the Backend
            raise ProviderUnavailableError("providerFailed", "The question provider failed.") from error

        return validate_output(raw, request)
