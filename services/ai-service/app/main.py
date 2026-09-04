from fastapi import FastAPI

from app.api.health import router as health_router
from app.core.config import settings


def create_app() -> FastAPI:
    app = FastAPI(
        title="StudyLens AI Service",
        version="0.1.0",
        description="AI service skeleton for StudyLens."
    )
    app.include_router(health_router)
    return app


app = create_app()

