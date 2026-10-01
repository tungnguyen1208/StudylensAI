import asyncio

from google import genai
from pydantic import BaseModel

from app.platform.config import settings
from app.platform.llm.gemini_provider import (
    GeminiJsonProvider,
    GeminiYoutubeTranscriptProvider,
    _provider_error,
)
from app.features.question_generation.schemas import QuestionGenerationResponse


class SdkError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code


class ProbeResponse(BaseModel):
    ok: bool


def test_sdk_quota_code_is_reported_without_exposing_provider_details() -> None:
    error = _provider_error(SdkError(429, "RESOURCE_EXHAUSTED: secret provider detail"))

    assert error.code == "providerRateLimited"
    assert error.retryable is True
    assert "secret provider detail" not in error.message


def test_sdk_auth_code_is_not_misreported_as_generic_failure() -> None:
    error = _provider_error(SdkError(403, "Invalid server credential"))

    assert error.code == "providerNotConfigured"
    assert error.retryable is False


def test_gemini_adapters_do_not_retry_inside_sdk(monkeypatch) -> None:
    captured = []
    monkeypatch.setattr(settings, "llm_api_key", "test-api-key")
    monkeypatch.setattr(genai, "Client", lambda **kwargs: captured.append(kwargs) or object())

    GeminiJsonProvider(ProbeResponse)
    GeminiYoutubeTranscriptProvider({"type": "object"})

    assert len(captured) == 2
    assert all(item["http_options"].retry_options.attempts == 1 for item in captured)


def test_quiz_adapter_uses_structured_generate_content(monkeypatch) -> None:
    class Models:
        async def generate_content(self, **kwargs):
            self.request = kwargs
            return type("Response", (), {"text": '{"ok": true}'})()

    models = Models()
    client = type("Client", (), {"aio": type("Async", (), {"models": models})()})()
    monkeypatch.setattr(settings, "llm_api_key", "test-api-key")
    monkeypatch.setattr(genai, "Client", lambda **kwargs: client)
    provider = GeminiJsonProvider(ProbeResponse)

    result = asyncio.run(provider.generate("Return JSON"))

    assert result == '{"ok": true}'
    assert models.request["contents"] == "Return JSON"
    assert models.request["config"].response_mime_type == "application/json"
    assert models.request["config"].response_json_schema["properties"]["ok"]["type"] == "boolean"


def test_real_quiz_schema_removes_unsupported_provider_keywords(monkeypatch) -> None:
    captured = []
    monkeypatch.setattr(settings, "llm_api_key", "test-api-key")
    monkeypatch.setattr(genai, "Client", lambda **kwargs: captured.append(kwargs) or object())

    provider = GeminiJsonProvider(QuestionGenerationResponse)
    schema = provider._generation_config.response_json_schema

    assert schema["properties"]["questions"]["items"]["$ref"] == "#/$defs/GeneratedQuestion"
    assert "exclusiveMinimum" not in str(schema)
    assert "minLength" not in str(schema)
    assert "default" not in str(schema)
