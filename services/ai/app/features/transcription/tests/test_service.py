import asyncio

import pytest

from app.features.transcription.service import TranscriptionProviderError, TranscriptionService
from app.platform.config import settings


def test_fake_provider_returns_a_valid_absolute_cue(monkeypatch):
    monkeypatch.setattr(settings, "stt_provider", "fake")
    result = asyncio.run(TranscriptionService().transcribe(b"fake-webm", "audio/webm", 30_000, 60_000))

    assert result.language == "und"
    assert result.cues[0].start_ms == 30_000
    assert result.cues[0].end_ms == 60_000


def test_unconfigured_provider_returns_safe_error(monkeypatch):
    monkeypatch.setattr(settings, "stt_provider", "disabled")
    with pytest.raises(TranscriptionProviderError):
        asyncio.run(TranscriptionService().transcribe(b"fake-webm", "audio/webm", 0, 1))
