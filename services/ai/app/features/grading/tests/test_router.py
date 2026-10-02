import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.features.grading.router import get_service, router
from app.features.grading.schemas import ShortAnswerGradeRequest, ShortAnswerGradeResponse
from app.features.grading.service import ShortAnswerGradingService
from app.platform.llm.provider import LlmProviderError


QUESTION_ID = "55555555-5555-4555-8555-555555555555"


def request(answer_text: str) -> ShortAnswerGradeRequest:
    return ShortAnswerGradeRequest(
        contractVersion="0.5.0",
        questionId=QUESTION_ID,
        prompt="Nêu vai trò của địa chỉ IP.",
        referenceAnswer="Địa chỉ IP định danh thiết bị hoặc giao diện mạng để định tuyến dữ liệu.",
        answerText=answer_text,
    )


class StaticProvider:
    def __init__(self, result: dict | str) -> None:
        self.result = result
        self.prompts: list[str] = []

    async def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.result if isinstance(self.result, str) else json.dumps(self.result, ensure_ascii=False)


class FailingProvider:
    async def generate(self, prompt: str) -> str:
        raise LlmProviderError("providerRateLimited", "The AI provider quota was reached.", True)


def test_fake_grader_returns_deterministic_results(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.features.grading.service.settings.llm_provider", "fake")

    correct = asyncio.run(ShortAnswerGradingService().grade(request(
        "Địa chỉ IP định danh thiết bị hoặc giao diện mạng để định tuyến dữ liệu."
    )))
    partial = asyncio.run(ShortAnswerGradingService().grade(request("Địa chỉ IP định danh thiết bị")))
    incorrect = asyncio.run(ShortAnswerGradingService().grade(request("HTTP tải trang web")))

    assert (correct.outcome, correct.score) == ("correct", 1)
    assert (partial.outcome, partial.score) == ("partiallyCorrect", 0.5)
    assert (incorrect.outcome, incorrect.score) == ("incorrect", 0)


def test_provider_grade_preserves_backend_reference_and_uses_evidence_prompt() -> None:
    provider = StaticProvider({
        "outcome": "partiallyCorrect",
        "score": 0.6,
        "explanation": "Câu trả lời đúng ý định danh nhưng còn thiếu ý định tuyến.",
    })

    result = asyncio.run(ShortAnswerGradingService(provider=provider).grade(request("IP định danh thiết bị.")))

    assert result.referenceAnswer == request("IP định danh thiết bị.").referenceAnswer
    assert result.outcome == "partiallyCorrect"
    assert QUESTION_ID in provider.prompts[0]
    assert "learnerAnswer" in provider.prompts[0]


def test_router_returns_contract_errors_for_invalid_provider_output_and_failure() -> None:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_service] = lambda: ShortAnswerGradingService(provider=StaticProvider("not-json"))
    client = TestClient(app)
    payload = request("IP định danh thiết bị.").model_dump()

    invalid_output = client.post("/api/ai/grading/short-answer", json=payload)
    assert invalid_output.status_code == 422
    assert invalid_output.json() == {
        "code": "invalidAiGrade",
        "message": "The grading provider returned an invalid result.",
        "retryable": False,
    }

    app.dependency_overrides[get_service] = lambda: ShortAnswerGradingService(provider=FailingProvider())
    failed = client.post("/api/ai/grading/short-answer", json=payload)
    assert failed.status_code == 503
    assert failed.json()["code"] == "providerRateLimited"
    assert failed.json()["retryable"] is True


def test_router_maps_invalid_request_to_400_contract_error() -> None:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_service] = lambda: ShortAnswerGradingService(provider=StaticProvider({}))
    response = TestClient(app).post("/api/ai/grading/short-answer", json={
        **request("valid").model_dump(),
        "answerText": "   ",
    })

    assert response.status_code == 400
    assert response.json()["code"] == "invalidGradingInput"
    assert response.json()["retryable"] is False


def test_grading_models_reject_blank_input_and_invalid_provider_output() -> None:
    with pytest.raises(ValidationError):
        request("   ")
    with pytest.raises(ValidationError):
        ShortAnswerGradeResponse(outcome="unexpected", score=2, referenceAnswer="", explanation="")
