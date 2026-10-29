from fastapi.testclient import TestClient

from app.main import app
from app.platform.config import settings


def test_health_reports_fake_provider_without_exposing_credentials(monkeypatch) -> None:
    monkeypatch.setattr(settings, "llm_provider", "fake")
    monkeypatch.setattr(settings, "llm_api_key", "")

    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "studylens-ai",
        "providerMode": "fake",
        "providerConfigured": True,
    }


def test_health_rejects_gemini_without_a_server_key(monkeypatch) -> None:
    monkeypatch.setattr(settings, "llm_provider", "gemini")
    monkeypatch.setattr(settings, "llm_api_key", "")

    response = TestClient(app).get("/health")

    assert response.status_code == 503
    assert response.json()["status"] == "notReady"
    assert response.json()["providerMode"] == "gemini"
    assert response.json()["providerConfigured"] is False
    assert "key" not in response.text.lower()


def test_health_accepts_configured_gemini_without_returning_the_key(monkeypatch) -> None:
    monkeypatch.setattr(settings, "llm_provider", "gemini")
    monkeypatch.setattr(settings, "llm_api_key", "server-only-secret")

    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json()["providerMode"] == "gemini"
    assert response.json()["providerConfigured"] is True
    assert "server-only-secret" not in response.text
