import os
from pydantic import BaseModel

class Settings(BaseModel):
    app_name: str = "StudyLens AI Service"
    app_version: str = "0.1.0"
    llm_provider: str = os.getenv("LLM_PROVIDER", "fake")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "")

settings = Settings()
