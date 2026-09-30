import json
from typing import Any

from app.platform.config import settings
from app.platform.llm.provider import LlmProviderError


class GeminiConfigurationError(RuntimeError):
    pass


class GeminiJsonProvider:
    """Server-only Gemini adapter using structured JSON output."""

    def __init__(self, response_schema: dict[str, Any]) -> None:
        if not settings.llm_api_key:
            raise GeminiConfigurationError("GEMINI_API_KEY is not configured")
        try:
            from google import genai
        except ImportError as error:
            raise GeminiConfigurationError("google-genai is not installed") from error
        self._client = genai.Client(api_key=settings.llm_api_key)
        self._response_schema = response_schema

    async def generate(self, prompt: str) -> str:
        try:
            interaction = await self._client.aio.interactions.create(
                model=settings.gemini_model,
                input=prompt,
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": self._response_schema,
                },
            )
        except Exception as error:  # The SDK exception classes vary between versions.
            raise _provider_error(error) from error
        return _response_text(interaction)


class GeminiYoutubeTranscriptProvider:
    """Reads one public YouTube URL directly; no media bytes pass through Backend."""

    def __init__(self, response_schema: dict[str, Any]) -> None:
        if not settings.llm_api_key:
            raise GeminiConfigurationError("GEMINI_API_KEY is not configured")
        try:
            from google import genai
        except ImportError as error:
            raise GeminiConfigurationError("google-genai is not installed") from error
        self._client = genai.Client(api_key=settings.llm_api_key)
        self._response_schema = response_schema

    async def generate(self, youtube_url: str, prompt: str) -> str:
        try:
            interaction = await self._client.aio.interactions.create(
                model=settings.gemini_model,
                input=[
                    {"type": "text", "text": prompt},
                    {"type": "video", "uri": youtube_url},
                ],
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": self._response_schema,
                },
            )
        except Exception as error:  # The SDK exception classes vary between versions.
            raise _provider_error(error) from error
        return _response_text(interaction)


def _response_text(response: object) -> str:
    direct = getattr(response, "text", None) or getattr(response, "output_text", None)
    if isinstance(direct, str) and direct.strip():
        return direct
    dumped = response.model_dump() if hasattr(response, "model_dump") else response
    if isinstance(dumped, dict):
        for key in ("output", "outputs", "content"):
            value = dumped.get(key)
            text = _find_text(value)
            if text:
                return text
    raise ValueError("Gemini returned no JSON text")


def _find_text(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        for item in value:
            found = _find_text(item)
            if found:
                return found
    if isinstance(value, dict):
        for key in ("text", "json", "content"):
            if key in value:
                candidate = value[key]
                if key == "json" and not isinstance(candidate, str):
                    return json.dumps(candidate, ensure_ascii=False)
                found = _find_text(candidate)
                if found:
                    return found
    return None


def _provider_error(error: Exception) -> LlmProviderError:
    """Normalise SDK failures into the AI contract without returning provider secrets."""
    status_code = getattr(error, "status_code", None)
    response = getattr(error, "response", None)
    status_code = status_code or getattr(response, "status_code", None)
    detail = str(error).casefold()
    if any(marker in detail for marker in ("safety", "recitation", "blocklist", "prohibited", "blocked")):
        return LlmProviderError("providerBlockedContent", "The provider blocked this content.", retryable=False)
    if status_code in {400, 401, 403, 404}:
        return LlmProviderError("providerNotConfigured", "The question provider rejected its server configuration.", retryable=False)
    if "timeout" in detail or "deadline" in detail:
        return LlmProviderError("providerTimeout", "The question provider did not answer in time.")
    return LlmProviderError("providerFailed", "The question provider failed.")
