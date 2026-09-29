import os
from dataclasses import dataclass

from app.platform.config import settings

# Feature-local provider settings. The shared platform Settings model is a HOT file and
# does not expose model/decoding options yet, so the values documented in .env.example
# are read here until an Integration Captain task moves them into Settings.

DEFAULT_MODEL = "gemini-3.8-flash"
DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_TEMPERATURE = 0.2
DEFAULT_MAX_OUTPUT_TOKENS = 4096

CONNECT_TIMEOUT_SECONDS = 5.0
READ_TIMEOUT_SECONDS = 20.0


class ProviderConfigError(Exception):
    """Raised when the selected provider cannot be configured from the environment."""


# ============================================================
# gemini configuration
# ============================================================

@dataclass(frozen=True)
class GeminiConfig:
    api_key: str
    model: str
    base_url: str
    temperature: float
    max_output_tokens: int

    @property
    def generate_url(self) -> str:
        return f"{self.base_url.rstrip('/')}/models/{self.model}:generateContent"


def load_gemini_config() -> GeminiConfig:
    api_key = settings.llm_api_key.strip()
    if not api_key:
        raise ProviderConfigError("GEMINI_API_KEY is not set for the gemini provider.")

    return GeminiConfig(
        api_key=api_key,
        model=os.getenv("GEMINI_MODEL") or os.getenv("LLM_MODEL") or DEFAULT_MODEL,
        base_url=settings.llm_base_url.strip() or DEFAULT_BASE_URL,
        temperature=_float_env("LLM_TEMPERATURE", DEFAULT_TEMPERATURE),
        max_output_tokens=_int_env("LLM_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS),
    )


# ============================================================
# env parsing
# ============================================================

def _float_env(name: str, fallback: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or fallback)
    except ValueError:
        return fallback


def _int_env(name: str, fallback: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or fallback)
    except ValueError:
        return fallback
