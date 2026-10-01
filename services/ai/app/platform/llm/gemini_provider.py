import json
import logging
from typing import Any

from pydantic import BaseModel

from app.platform.config import settings
from app.platform.llm.provider import LlmProviderError

logger = logging.getLogger(__name__)

_JSON_SCHEMA_KEYS = frozenset({
    "$defs", "$ref", "type", "format", "title", "description", "enum",
    "items", "minItems", "maxItems", "minimum", "maximum", "anyOf",
    "oneOf", "properties", "additionalProperties", "required",
})


class GeminiConfigurationError(RuntimeError):
    pass


class GeminiJsonProvider:
    """Server-only Gemini adapter using structured JSON output."""

    def __init__(self, response_schema: type[BaseModel]) -> None:
        if not settings.llm_api_key:
            raise GeminiConfigurationError("GEMINI_API_KEY is not configured")
        try:
            from google import genai
            from google.genai import types
        except ImportError as error:
            raise GeminiConfigurationError("google-genai is not installed") from error
        # The Backend owns durable retries. SDK retries would hide quota errors
        # and can consume the entire Backend request timeout before surfacing one.
        self._client = genai.Client(
            api_key=settings.llm_api_key,
            http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=1)),
        )
        self._generation_config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=_provider_json_schema(response_schema.model_json_schema()),
        )

    async def generate(self, prompt: str) -> str:
        try:
            response = await self._client.aio.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=self._generation_config,
            )
        except Exception as error:  # The SDK exception classes vary between versions.
            raise _provider_error(error) from error
        return _response_text(response)


class GeminiYoutubeTranscriptProvider:
    """Reads one public YouTube URL directly; no media bytes pass through Backend."""

    def __init__(self, response_schema: dict[str, Any]) -> None:
        if not settings.llm_api_key:
            raise GeminiConfigurationError("GEMINI_API_KEY is not configured")
        try:
            from google import genai
            from google.genai import types
        except ImportError as error:
            raise GeminiConfigurationError("google-genai is not installed") from error
        self._client = genai.Client(
            api_key=settings.llm_api_key,
            http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=1)),
        )
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


def _provider_json_schema(value: Any, parent_key: str | None = None) -> Any:
    """Keep only the JSON Schema subset accepted by Gemini; validate locally in full."""
    if isinstance(value, list):
        return [_provider_json_schema(item) for item in value]
    if not isinstance(value, dict):
        return value
    if parent_key in {"properties", "$defs"}:
        return {key: _provider_json_schema(item) for key, item in value.items()}
    return {key: _provider_json_schema(item, key) for key, item in value.items() if key in _JSON_SCHEMA_KEYS}


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
    status_code = status_code or getattr(error, "code", None) or getattr(response, "status_code", None)
    try:
        status_code = int(status_code)
    except (TypeError, ValueError):
        status_code = None
    detail = str(error).casefold()
    logger.warning("Gemini request failed: exception=%s status=%s", type(error).__name__, status_code)
    if status_code == 429 or "resource_exhausted" in detail or "quota exceeded" in detail:
        return LlmProviderError("providerRateLimited", "The AI provider rate limit or quota was reached. Retry later.")
    if any(marker in detail for marker in ("safety", "recitation", "blocklist", "prohibited", "blocked")):
        return LlmProviderError("providerBlockedContent", "The provider blocked this content.", retryable=False)
    if status_code in {400, 401, 403, 404}:
        return LlmProviderError("providerNotConfigured", "The question provider rejected its server configuration.", retryable=False)
    if "timeout" in detail or "deadline" in detail:
        return LlmProviderError("providerTimeout", "The question provider did not answer in time.")
    return LlmProviderError("providerFailed", "The question provider failed.")
