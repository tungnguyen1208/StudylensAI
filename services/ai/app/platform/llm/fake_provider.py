from app.platform.llm.provider import LlmProvider

class FakeLlmProvider:
    """Deterministic offline LLM provider for testing and local development without API keys."""

    async def generate(self, prompt: str) -> str:
        return '{"result": "deterministic_fake_response"}'
