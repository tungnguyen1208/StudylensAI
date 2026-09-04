from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    llm_provider: str = os.getenv("LLM_PROVIDER", "mock")
    llm_base_url: str | None = os.getenv("LLM_BASE_URL")


settings = Settings()

