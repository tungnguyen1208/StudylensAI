from typing import Callable, Coroutine

from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from app.features.grading.schemas import AiErrorEnvelope, ShortAnswerGradeRequest, ShortAnswerGradeResponse
from app.features.grading.service import (
    GradingProviderUnavailableError,
    InvalidGradeOutputError,
    ShortAnswerGradingService,
)


def _envelope(status_code: int, code: str, message: str, retryable: bool) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=AiErrorEnvelope(code=code, message=message, retryable=retryable).model_dump(),
    )


class GradingErrorRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[None, None, Response]]:
        handler = super().get_route_handler()

        async def guarded(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError:
                return _envelope(400, "invalidGradingInput", "The grading request is invalid.", False)

        return guarded


router = APIRouter(
    prefix="/api/ai/grading",
    tags=["Grading (Dev 3)"],
    route_class=GradingErrorRoute,
)


def get_service() -> ShortAnswerGradingService:
    return ShortAnswerGradingService()


@router.post("/short-answer", response_model=ShortAnswerGradeResponse)
async def grade_short_answer(
    request: ShortAnswerGradeRequest,
    service: ShortAnswerGradingService = Depends(get_service),
) -> Response:
    try:
        grade = await service.grade(request)
    except InvalidGradeOutputError as error:
        return _envelope(422, error.code, error.message, False)
    except GradingProviderUnavailableError as error:
        return _envelope(503, error.code, error.message, error.retryable)
    return JSONResponse(status_code=200, content=grade.model_dump())
