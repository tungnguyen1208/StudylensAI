from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.platform.config import settings
from app.platform.health import router as health_router
from app.features.question_generation.router import router as question_generation_router
from app.features.grading.router import router as grading_router

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Stateless AI Microservice for StudyLens Active Learning System",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Health Router
app.include_router(health_router)

# Register the AI-owned vertical feature routers. Persistent Activation has no
# FastAPI feature: Dev 1 never classifies a video's subject matter in v1.2.
app.include_router(question_generation_router)
app.include_router(grading_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
