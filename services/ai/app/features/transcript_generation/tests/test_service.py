import asyncio
import json

import pytest

from app.features.transcript_generation.schemas import TranscriptGenerationRequest
from app.features.transcript_generation.service import TranscriptGenerationError, TranscriptGenerationService


class StubProvider:
    def __init__(self, payload: dict | None = None, delay: float = 0, error: Exception | None = None) -> None:
        self.payload = payload
        self.delay = delay
        self.error = error
        self.youtube_url: str | None = None

    async def generate(self, youtube_url: str, prompt: str) -> str:
        del prompt
        self.youtube_url = youtube_url
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return json.dumps(self.payload)


def request() -> TranscriptGenerationRequest:
    return TranscriptGenerationRequest(contractVersion="0.5.0", youtubeVideoId="dQw4w9WgXcQ")


def test_generates_normalized_timestamped_transcript_for_public_video() -> None:
    provider = StubProvider({
        "language": "EN",
        "cues": [
            {"startMs": 5000, "endMs": 10000, "text": " second   cue "},
            {"startMs": 0, "endMs": 5000, "text": " first cue "},
        ],
    })

    result = asyncio.run(TranscriptGenerationService(provider=provider).generate(request()))

    assert provider.youtube_url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert result.source == "geminiVideo"
    assert result.language == "en"
    assert result.durationMs == 10000
    assert [cue.text for cue in result.cues] == ["first cue", "second cue"]


def test_rejects_invalid_structured_output_without_inventing_transcript() -> None:
    provider = StubProvider({"language": "en", "cues": [{"startMs": 10, "endMs": 5, "text": "invalid"}]})

    with pytest.raises(TranscriptGenerationError) as error:
        asyncio.run(TranscriptGenerationService(provider=provider).generate(request()))

    assert error.value.code == "invalidAiTranscript"
    assert error.value.retryable is False


def test_maps_private_or_unlisted_video_to_non_retryable_unavailable() -> None:
    provider = StubProvider(error=RuntimeError("private video permission denied"))

    with pytest.raises(TranscriptGenerationError) as error:
        asyncio.run(TranscriptGenerationService(provider=provider).generate(request()))

    assert error.value.code == "videoUnavailable"
    assert error.value.status_code == 404
    assert error.value.retryable is False


def test_timeout_is_retryable() -> None:
    provider = StubProvider({"language": "en", "cues": []}, delay=0.05)

    with pytest.raises(TranscriptGenerationError) as error:
        asyncio.run(TranscriptGenerationService(provider=provider, timeout_seconds=0.01).generate(request()))

    assert error.value.code == "providerTimeout"
    assert error.value.retryable is True
