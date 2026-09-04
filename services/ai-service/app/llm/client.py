from abc import ABC, abstractmethod
from typing import Any


class LLMClient(ABC):
    @abstractmethod
    async def complete_json(self, prompt: str, schema: type[Any]) -> Any:
        """Return structured model output validated by the caller's schema."""

