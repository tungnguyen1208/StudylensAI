from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["Health"])

class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "studylens-ai"

@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    return HealthResponse()
