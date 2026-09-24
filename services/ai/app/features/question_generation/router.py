from typing import Callable, Coroutine

from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from app.features.question_generation.output_validator import InvalidAiOutputError
from app.features.question_generation.schemas import (
    AiErrorEnvelope,
    QuestionGenerationRequest,
    QuestionGenerationResponse,
)
from app.features.question_generation.service import (
    InsufficientEvidenceRejected,
    ProviderUnavailableError,
    QuestionGenerationService,
)


# ============================================================
# contract-shaped validation errors
# ============================================================

def _envelope(status_code: int, code: str, message: str, retryable: bool) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=AiErrorEnvelope(code=code, message=message, retryable=retryable).model_dump(),
    )


class AiErrorRoute(APIRoute):
    """Maps FastAPI validation failures onto the AiErrorEnvelope in the AI contract."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[None, None, Response]]:
        handler = super().get_route_handler()

        async def guarded(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError:
                return _envelope(400, "invalidSegmentInput", "The question generation request is invalid.", False)

        return guarded


router = APIRouter(
    prefix="/api/ai/question-generation",
    tags=["Question Generation (Dev 2)"],
    route_class=AiErrorRoute,
)


# ============================================================
# endpoint
# ============================================================

def get_service() -> QuestionGenerationService:
    return QuestionGenerationService()


@router.post("/generate", response_model=QuestionGenerationResponse)
async def generate_questions(
    request: QuestionGenerationRequest,
    service: QuestionGenerationService = Depends(get_service),
) -> Response:
    try:
        response = await service.generate(request)
    except InsufficientEvidenceRejected as error:
        return _envelope(400, error.code, error.message, False)
    except InvalidAiOutputError as error:
        return _envelope(422, error.code, error.message, False)
    except ProviderUnavailableError as error:
        return _envelope(503, error.code, error.message, True)

    return JSONResponse(status_code=200, content=response.model_dump(exclude_none=True))
