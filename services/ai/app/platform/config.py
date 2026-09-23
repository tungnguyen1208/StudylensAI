import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel


# Load only the ignored repository-local environment file. Secrets remain
# server-side and are never bundled into the Browser Extension.
load_dotenv(Path(__file__).resolve().parents[4] / ".env")


class Settings(BaseModel):
    app_name: str = "StudyLens AI Service"
    app_version: str = "0.3.0"
    llm_provider: str = os.getenv("LLM_PROVIDER", "fake")
    llm_api_key: str = os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "")
    stt_provider: str = os.getenv("STT_PROVIDER", "fake")
    gemini_transcribe_model: str = os.getenv("GEMINI_TRANSCRIBE_MODEL", "gemini-3.5-transcribe")

settings = Settings()
