import asyncio

import pytest
from pydantic import ValidationError

from app.features.grading.router import (
    ShortAnswerGradeRequest,
    ShortAnswerGradeResponse,
    grade_short_answer,
)


def request(answer_text: str) -> ShortAnswerGradeRequest:
    return ShortAnswerGradeRequest(
        contractVersion="0.4.0",
        questionId="55555555-5555-4555-8555-555555555555",
        prompt="Nêu vai trò của địa chỉ IP.",
        referenceAnswer="Địa chỉ IP định danh thiết bị hoặc giao diện mạng để định tuyến dữ liệu.",
        answerText=answer_text,
    )


def test_fake_grader_returns_deterministic_correct_result() -> None:
    result = asyncio.run(grade_short_answer(request("Địa chỉ IP định danh thiết bị hoặc giao diện mạng để định tuyến dữ liệu.")))

    assert result.outcome == "correct"
    assert result.score == 1


def test_fake_grader_returns_partial_and_incorrect_results() -> None:
    partial = asyncio.run(grade_short_answer(request("Địa chỉ IP định danh thiết bị")))
    incorrect = asyncio.run(grade_short_answer(request("HTTP tải trang web")))

    assert (partial.outcome, partial.score) == ("partiallyCorrect", 0.5)
    assert (incorrect.outcome, incorrect.score) == ("incorrect", 0)


def test_grading_models_reject_blank_input_and_invalid_provider_output() -> None:
    with pytest.raises(ValidationError):
        request("   ")
    with pytest.raises(ValidationError):
        ShortAnswerGradeResponse(outcome="unexpected", score=2, referenceAnswer="", explanation="")
