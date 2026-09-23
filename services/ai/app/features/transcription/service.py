import base64
import json

import httpx

from app.features.transcription.schemas import TranscriptionCue, TranscriptionResponse
from app.platform.config import settings


class TranscriptionProviderError(Exception):
    pass


class TranscriptionService:
    async def transcribe(self, audio: bytes, mime_type: str, start_ms: int, end_ms: int) -> TranscriptionResponse:
        if not audio or end_ms <= start_ms:
            raise TranscriptionProviderError("invalid audio transcription request")
        if settings.stt_provider == "fake":
            return TranscriptionResponse(language="und", cues=[TranscriptionCue(start_ms=start_ms, end_ms=end_ms, text="Deterministic fake audio transcript.")])
        if settings.stt_provider != "gemini" or not settings.llm_api_key:
            raise TranscriptionProviderError("STT provider is not configured")

        prompt = (
            "Transcribe this audio. Return JSON only with language (BCP-47) and cues. "
            f"Every cue start_ms/end_ms must be within [{start_ms},{end_ms}] and text must be spoken content."
        )
        body = {
            "contents": [{"parts": [
                {"text": prompt},
                {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(audio).decode("ascii")}},
            ]}],
            "generationConfig": {"responseMimeType": "application/json"},
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_transcribe_model}:generateContent"
        try:
            async with httpx.AsyncClient(timeout=40.0) as client:
                response = await client.post(url, params={"key": settings.llm_api_key}, json=body)
            response.raise_for_status()
            text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
            transcription = TranscriptionResponse.model_validate(json.loads(text))
            # Gemini can return offsets relative to the supplied audio chunk. Convert
            # those offsets to the absolute YouTube playback timeline once, server-side.
            chunk_duration_ms = end_ms - start_ms
            if all(cue.end_ms <= chunk_duration_ms for cue in transcription.cues):
                transcription = transcription.model_copy(update={
                    "cues": [cue.model_copy(update={
                        "start_ms": cue.start_ms + start_ms,
                        "end_ms": cue.end_ms + start_ms,
                    }) for cue in transcription.cues],
                })
            return transcription
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise TranscriptionProviderError("Gemini transcription failed") from error
