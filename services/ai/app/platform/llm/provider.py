from typing import Protocol, runtime_checkable

@runtime_checkable
class LlmProvider(Protocol):
    """Abstract interface for LLM operations to avoid vendor lock-in."""

    async def generate(self, prompt: str) -> str:
        """Generate text completion from a prompt."""
        ...
