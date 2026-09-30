from collections.abc import Callable, Coroutine

from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from app.features.transcript_generation.schemas import AiErrorEnvelope, TranscriptGenerationRequest, TranscriptGenerationResponse
from app.features.transcript_generation.service import TranscriptGenerationError, TranscriptGenerationService


def _envelope(status_code: int, code: str, message: str, retryable: bool) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=AiErrorEnvelope(code=code, message=message, retryable=retryable).model_dump())


class TranscriptErrorRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[None, None, Response]]:
        handler = super().get_route_handler()

        async def guarded(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError:
                return _envelope(400, "invalidTranscriptInput", "The transcript generation request is invalid.", False)

        return guarded


router = APIRouter(prefix="/api/ai/transcripts", tags=["Transcript Generation"], route_class=TranscriptErrorRoute)


def get_service() -> TranscriptGenerationService:
    return TranscriptGenerationService()


@router.post("/generate", response_model=TranscriptGenerationResponse)
async def generate_transcript(request: TranscriptGenerationRequest, service: TranscriptGenerationService = Depends(get_service)) -> Response:
    try:
        response = await service.generate(request)
    except TranscriptGenerationError as error:
        return _envelope(error.status_code, error.code, error.message, error.retryable)
    return JSONResponse(status_code=200, content=response.model_dump(exclude_none=True))
