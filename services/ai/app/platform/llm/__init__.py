"""LLM Provider abstraction package."""
from app.platform.llm.provider import LlmProvider
from app.platform.llm.fake_provider import FakeLlmProvider

__all__ = ["LlmProvider", "FakeLlmProvider"]
