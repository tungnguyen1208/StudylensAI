from typing import Protocol, runtime_checkable


class LlmProviderError(RuntimeError):
    """A provider failure that the use case can expose without leaking vendor details."""

    def __init__(self, code: str, message: str, retryable: bool = True) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@runtime_checkable
class LlmProvider(Protocol):
    """Abstract interface for LLM operations to avoid vendor lock-in."""

    async def generate(self, prompt: str) -> str:
        """Generate text completion from a prompt."""
        ...
