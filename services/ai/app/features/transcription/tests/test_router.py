import asyncio

import httpx

from app.main import app
from app.platform.config import settings


def test_router_accepts_contract_camel_case_timestamps_and_returns_camel_case_cues(monkeypatch):
    monkeypatch.setattr(settings, "stt_provider", "fake")

    async def post_chunk():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post(
                "/api/transcriptions",
                data={"startMs": "30000", "endMs": "60000"},
                files={"audio": ("chunk.webm", b"fake-webm", "audio/webm")},
            )

    response = asyncio.run(post_chunk())

    assert response.status_code == 200
    assert response.json()["cues"][0]["startMs"] == 30000
    assert response.json()["cues"][0]["endMs"] == 60000

