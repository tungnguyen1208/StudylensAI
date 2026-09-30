import asyncio
import json
from typing import Protocol

from pydantic import ValidationError

from app.features.transcript_generation.schemas import (
    GeneratedTranscriptCue,
    TranscriptGenerationRequest,
    TranscriptGenerationResponse,
    TranscriptProviderPayload,
)
from app.platform.config import settings
from app.platform.llm.gemini_provider import GeminiConfigurationError, GeminiYoutubeTranscriptProvider


class TranscriptProvider(Protocol):
    async def generate(self, youtube_url: str, prompt: str) -> str: ...


class TranscriptGenerationError(Exception):
    def __init__(self, code: str, message: str, retryable: bool, status_code: int = 503) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.status_code = status_code


class DeterministicTranscriptProvider:
    async def generate(self, youtube_url: str, prompt: str) -> str:
        del youtube_url, prompt
        return json.dumps({
            "language": "und",
            "durationMs": 900_000,
            "cues": [
                {"startMs": 0, "endMs": 300_000, "text": "Nội dung giả lập phần mở đầu của video dùng cho kiểm thử tích hợp."},
                {"startMs": 300_000, "endMs": 600_000, "text": "Nội dung giả lập phần giữa có timestamp và đủ bằng chứng."},
                {"startMs": 600_000, "endMs": 900_000, "text": "Nội dung giả lập phần kết thúc của video cho luồng quiz toàn video."},
            ],
        }, ensure_ascii=False)


def resolve_provider() -> TranscriptProvider:
    if settings.llm_provider == "fake":
        return DeterministicTranscriptProvider()
    if settings.llm_provider == "gemini":
        try:
            return GeminiYoutubeTranscriptProvider(TranscriptProviderPayload.model_json_schema())
        except GeminiConfigurationError as error:
            raise TranscriptGenerationError("providerNotConfigured", str(error), True) from error
    raise TranscriptGenerationError("providerNotConfigured", f"LLM provider '{settings.llm_provider}' is not supported.", True)


class TranscriptGenerationService:
    def __init__(self, provider: TranscriptProvider | None = None, timeout_seconds: float | None = None) -> None:
        self._provider = provider
        self._timeout_seconds = timeout_seconds if timeout_seconds is not None else settings.transcript_timeout_seconds

    async def generate(self, request: TranscriptGenerationRequest) -> TranscriptGenerationResponse:
        provider = self._provider or resolve_provider()
        youtube_url = f"https://www.youtube.com/watch?v={request.youtubeVideoId}"
        prompt = (
            "Transcribe the complete public YouTube video into timestamped cues. "
            "Preserve the spoken language, do not translate or invent content, and return JSON only."
        )
        try:
            raw = await asyncio.wait_for(provider.generate(youtube_url, prompt), timeout=self._timeout_seconds)
        except asyncio.TimeoutError as error:
            raise TranscriptGenerationError("providerTimeout", "Video transcript generation timed out.", True) from error
        except TranscriptGenerationError:
            raise
        except Exception as error:  # noqa: BLE001
            text = str(error).casefold()
            if any(marker in text for marker in ("private", "unlisted", "not found", "permission")):
                raise TranscriptGenerationError("videoUnavailable", "The YouTube video is not publicly accessible.", False, 404) from error
            raise TranscriptGenerationError("providerFailed", "The transcript provider failed.", True) from error

        try:
            payload = TranscriptProviderPayload.model_validate_json(raw)
        except (ValidationError, ValueError) as error:
            raise TranscriptGenerationError("invalidAiTranscript", "The provider returned an invalid timestamped transcript.", False, 422) from error
        cues = sorted(payload.cues, key=lambda cue: (cue.startMs, cue.endMs))
        if not cues:
            raise TranscriptGenerationError("videoUnavailable", "No transcript could be generated for this public video.", False, 404)
        return TranscriptGenerationResponse(
            youtubeVideoId=request.youtubeVideoId,
            language=payload.language.strip().lower(),
            durationMs=payload.durationMs or max(cue.endMs for cue in cues),
            cues=[GeneratedTranscriptCue(startMs=cue.startMs, endMs=cue.endMs, text=" ".join(cue.text.split())) for cue in cues],
        )
