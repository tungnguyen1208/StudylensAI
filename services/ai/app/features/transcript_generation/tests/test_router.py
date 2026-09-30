from fastapi.testclient import TestClient

from app.features.transcript_generation.router import get_service
from app.features.transcript_generation.service import TranscriptGenerationService
from app.main import app


client = TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_transcript_route_returns_contract_shape() -> None:
    response = client.post("/api/ai/transcripts/generate", json={
        "contractVersion": "0.5.0",
        "youtubeVideoId": "dQw4w9WgXcQ",
    })

    assert response.status_code == 200
    assert response.json()["contractVersion"] == "0.5.0"
    assert response.json()["source"] == "geminiVideo"
    assert response.json()["cues"]


def test_transcript_route_rejects_invalid_video_id() -> None:
    response = client.post("/api/ai/transcripts/generate", json={
        "contractVersion": "0.5.0",
        "youtubeVideoId": "invalid",
    })

    assert response.status_code == 400
    assert response.json()["code"] == "invalidTranscriptInput"
    assert response.json()["retryable"] is False


def test_transcript_route_does_not_accept_provider_or_api_key_from_browser() -> None:
    response = client.post("/api/ai/transcripts/generate", json={
        "contractVersion": "0.5.0",
        "youtubeVideoId": "dQw4w9WgXcQ",
        "apiKey": "must-not-cross-contract",
    })

    assert response.status_code == 400
