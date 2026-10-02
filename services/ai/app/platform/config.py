import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel


# Load an ignored repository-local environment file when running from a source
# checkout. A production image has no .env file and receives secrets only via
# its process environment.
for parent in Path(__file__).resolve().parents:
    candidate = parent / ".env"
    if candidate.is_file():
        load_dotenv(candidate)
        break


class Settings(BaseModel):
    app_name: str = "StudyLens AI Service"
    app_version: str = "0.5.0"
    llm_provider: str = os.getenv("LLM_PROVIDER", "fake")
    llm_api_key: str = os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    transcript_timeout_seconds: float = float(os.getenv("TRANSCRIPT_TIMEOUT_SECONDS", "300"))
    quiz_timeout_seconds: float = float(os.getenv("QUIZ_TIMEOUT_SECONDS", "180"))
    grading_timeout_seconds: float = float(os.getenv("GRADING_TIMEOUT_SECONDS", "60"))

settings = Settings()
