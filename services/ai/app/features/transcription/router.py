from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.features.transcription.schemas import TranscriptionResponse
from app.features.transcription.service import TranscriptionProviderError, TranscriptionService

router = APIRouter(prefix="/api/transcriptions", tags=["Transcription"])


@router.post("", response_model=TranscriptionResponse)
async def transcribe(
    audio: UploadFile = File(...),
    start_ms: int = Form(..., alias="startMs", ge=0),
    end_ms: int = Form(..., alias="endMs", gt=0),
) -> TranscriptionResponse:
    if end_ms <= start_ms or audio.content_type not in {"audio/webm", "audio/webm;codecs=opus"}:
        raise HTTPException(status_code=422, detail="invalidAudioChunk")
    try:
        return await TranscriptionService().transcribe(await audio.read(), audio.content_type, start_ms, end_ms)
    except TranscriptionProviderError as error:
        raise HTTPException(status_code=502, detail="sttProviderFailed") from error
