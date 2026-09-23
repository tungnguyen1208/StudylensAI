import asyncio

from fastapi.testclient import TestClient

from app.features.question_generation.router import get_service, router
from app.features.question_generation.service import QuestionGenerationService
from app.main import app

LONG_CUE = "TCP chia dữ liệu thành các segment có thứ tự và truyền lại phần bị mất."

VALID_BODY = {
    "contractVersion": "0.3.0",
    "promptVersion": "0.3.0",
    "segmentId": "11111111-1111-4111-8111-111111111111",
    "youtubeVideoId": "dQw4w9WgXcQ",
    "startMs": 0,
    "endMs": 300000,
    "questionType": "multipleChoice",
    "difficulty": "medium",
    "cues": [{"startMs": 0, "endMs": 30000, "text": LONG_CUE}],
}

client = TestClient(app)


# ============================================================
# helpers
# ============================================================

class StubProvider:
    def __init__(self, payload: str = "", delay: float = 0.0) -> None:
        self.payload = payload
        self.delay = delay

    async def generate(self, prompt: str) -> str:
        if self.delay:
            await asyncio.sleep(self.delay)
        return self.payload


def override_provider(payload: str = "", delay: float = 0.0, timeout: float = 3.0) -> None:
    app.dependency_overrides[get_service] = lambda: QuestionGenerationService(
        provider=StubProvider(payload=payload, delay=delay), timeout_seconds=timeout
    )


def post(body: dict | None = None):
    return client.post("/api/ai/question-generation/generate", json=body or VALID_BODY)


def teardown_function() -> None:
    app.dependency_overrides.clear()


# ============================================================
# contract surface
# ============================================================

def test_router_keeps_the_dev2_contract_prefix() -> None:
    assert router.prefix == "/api/ai/question-generation"


def test_returns_a_public_safe_multiple_choice_payload() -> None:
    response = post()
    body = response.json()

    assert response.status_code == 200
    assert body["contractVersion"] == "0.3.0"
    assert body["promptVersion"] == "0.3.0"
    assert body["questions"][0]["correctOptionId"] == "option-a"
    assert "referenceAnswer" not in body["questions"][0]


def test_returns_a_short_answer_payload_without_options() -> None:
    body = post({**VALID_BODY, "questionType": "shortAnswer"}).json()

    assert body["questions"][0]["type"] == "shortAnswer"
    assert "options" not in body["questions"][0]
    assert body["questions"][0]["referenceAnswer"]


# ============================================================
# error envelope mapping
# ============================================================

def test_unsupported_contract_version_returns_the_ai_error_envelope() -> None:
    response = post({**VALID_BODY, "contractVersion": "0.1.0"})

    assert response.status_code == 400
    assert response.json() == {
        "code": "invalidSegmentInput",
        "message": "The question generation request is invalid.",
        "retryable": False,
    }


def test_cue_outside_the_segment_range_is_rejected() -> None:
    response = post({**VALID_BODY, "cues": [{"startMs": 0, "endMs": 400000, "text": LONG_CUE}]})

    assert response.status_code == 400
    assert response.json()["code"] == "invalidSegmentInput"


def test_unknown_field_is_rejected_by_the_forbidden_extra_rule() -> None:
    assert post({**VALID_BODY, "modelHint": "gemini"}).status_code == 400


def test_insufficient_transcript_returns_a_non_retryable_400() -> None:
    response = post({**VALID_BODY, "cues": [{"startMs": 0, "endMs": 1000, "text": "Ngắn."}]})

    assert response.status_code == 400
    assert response.json() == {
        "code": "transcriptInsufficient",
        "message": "transcript evidence is too short for a grounded question",
        "retryable": False,
    }


def test_invalid_provider_output_returns_a_non_retryable_422() -> None:
    override_provider(payload='{"questions": [{"type": "multipleChoice", "prompt": "x", "sourceStartMs": 0, "sourceEndMs": 5}]}')

    response = post()

    assert response.status_code == 422
    assert response.json()["code"] == "invalidAiOutputOptions"
    assert response.json()["retryable"] is False


def test_malformed_provider_output_returns_a_non_retryable_422() -> None:
    override_provider(payload="{not json")

    response = post()

    assert response.status_code == 422
    assert response.json()["code"] == "invalidAiOutputJson"


def test_provider_timeout_returns_a_retryable_503() -> None:
    override_provider(payload="{}", delay=0.05, timeout=0.01)

    response = post()

    assert response.status_code == 503
    assert response.json() == {
        "code": "providerTimeout",
        "message": "The question provider did not answer in time.",
        "retryable": True,
    }
