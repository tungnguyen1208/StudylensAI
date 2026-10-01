import pytest

from app.platform.config import settings


@pytest.fixture(autouse=True)
def use_offline_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unit tests must never consume the server's configured Gemini quota."""
    monkeypatch.setattr(settings, "llm_provider", "fake")
