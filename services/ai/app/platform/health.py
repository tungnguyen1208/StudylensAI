from fastapi import APIRouter, Response, status
from pydantic import BaseModel

from app.platform.config import settings

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "studylens-ai"
    providerMode: str
    providerConfigured: bool


@router.get("/health", response_model=HealthResponse)
async def get_health(response: Response) -> HealthResponse:
    provider_mode = settings.llm_provider.strip().lower()
    provider_configured = provider_mode == "fake" or (
        provider_mode == "gemini" and bool(settings.llm_api_key.strip())
    )
    if not provider_configured:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthResponse(
        status="ok" if provider_configured else "notReady",
        providerMode=provider_mode,
        providerConfigured=provider_configured,
    )
