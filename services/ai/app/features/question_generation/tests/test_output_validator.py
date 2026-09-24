import json

import pytest

from app.features.question_generation.output_validator import InvalidAiOutputError, validate_output
from app.features.question_generation.schemas import QuestionGenerationRequest

# ============================================================
# helpers
# ============================================================

def request_for(question_type: str = "multipleChoice") -> QuestionGenerationRequest:
    return QuestionGenerationRequest(
        contractVersion="0.4.0",
        promptVersion="0.4.0",
        segmentId="11111111-1111-4111-8111-111111111111",
        youtubeVideoId="dQw4w9WgXcQ",
        startMs=0,
        endMs=300_000,
        questionType=question_type,
        difficulty="medium",
        cues=[{"startMs": 0, "endMs": 30_000, "text": "TCP chia dữ liệu thành các segment có thứ tự."}],
    )


def mcq(**overrides) -> str:
    question = {
        "type": "multipleChoice",
        "prompt": "Theo transcript, TCP làm gì?",
        "options": [
            {"optionId": "option-a", "text": "Chia dữ liệu thành segment có thứ tự"},
            {"optionId": "option-b", "text": "Mã hoá video"},
            {"optionId": "option-c", "text": "Tăng độ phân giải"},
        ],
        "correctOptionId": "option-a",
        "sourceStartMs": 0,
        "sourceEndMs": 30_000,
    }
    question.update(overrides)
    return json.dumps({"questions": [question]})


def short_answer(**overrides) -> str:
    question = {
        "type": "shortAnswer",
        "prompt": "Tóm tắt vai trò của TCP.",
        "referenceAnswer": "TCP chia dữ liệu thành các segment có thứ tự.",
        "sourceStartMs": 0,
        "sourceEndMs": 30_000,
    }
    question.update(overrides)
    return json.dumps({"questions": [question]})


def code_of(raw: str, request: QuestionGenerationRequest) -> str:
    with pytest.raises(InvalidAiOutputError) as error:
        validate_output(raw, request)
    return error.value.code


# ============================================================
# accepted output
# ============================================================

def test_accepts_a_valid_multiple_choice_question() -> None:
    response = validate_output(mcq(), request_for())

    assert response.contractVersion == "0.4.0"
    assert response.promptVersion == "0.4.0"
    assert response.questions[0].correctOptionId == "option-a"


def test_accepts_a_valid_short_answer_question() -> None:
    response = validate_output(short_answer(), request_for("shortAnswer"))

    assert response.questions[0].referenceAnswer is not None
    assert response.questions[0].options is None


# ============================================================
# malformed or schema-invalid output
# ============================================================

def test_rejects_malformed_json() -> None:
    assert code_of("{not json", request_for()) == "invalidAiOutputJson"
    assert code_of("[]", request_for()) == "invalidAiOutputJson"


def test_rejects_an_empty_or_missing_question_list() -> None:
    assert code_of(json.dumps({"questions": []}), request_for()) == "invalidAiOutput"
    assert code_of(json.dumps({"other": 1}), request_for()) == "invalidAiOutput"


def test_rejects_a_question_missing_required_fields() -> None:
    raw = json.dumps({"questions": [{"type": "multipleChoice", "prompt": "Thiếu source"}]})
    assert code_of(raw, request_for()) == "invalidAiOutputSchema"


def test_rejects_a_question_type_the_request_did_not_ask_for() -> None:
    assert code_of(short_answer(), request_for("multipleChoice")) == "invalidAiOutputType"


# ============================================================
# timestamp rules
# ============================================================

def test_rejects_a_source_range_outside_the_segment() -> None:
    assert code_of(mcq(sourceStartMs=400_000, sourceEndMs=420_000), request_for()) == "invalidAiOutputTimestamp"
    assert code_of(mcq(sourceEndMs=300_001), request_for()) == "invalidAiOutputTimestamp"


def test_rejects_a_backwards_source_range() -> None:
    assert code_of(mcq(sourceStartMs=20_000, sourceEndMs=10_000), request_for()) == "invalidAiOutputTimestamp"


# ============================================================
# multiple-choice rules
# ============================================================

def test_rejects_too_few_options() -> None:
    raw = mcq(options=[{"optionId": "option-a", "text": "Chỉ một lựa chọn"}])
    assert code_of(raw, request_for()) == "invalidAiOutputOptions"


def test_rejects_duplicate_option_ids_and_duplicate_texts() -> None:
    duplicate_ids = mcq(options=[
        {"optionId": "option-a", "text": "Một"},
        {"optionId": "option-a", "text": "Hai"},
    ])
    duplicate_texts = mcq(options=[
        {"optionId": "option-a", "text": "Cùng nội dung"},
        {"optionId": "option-b", "text": "cùng   NỘI dung"},
    ])
    assert code_of(duplicate_ids, request_for()) == "invalidAiOutputOptions"
    assert code_of(duplicate_texts, request_for()) == "invalidAiOutputOptions"


def test_rejects_an_answer_key_that_does_not_exist() -> None:
    assert code_of(mcq(correctOptionId="option-z"), request_for()) == "invalidAiOutputAnswerKey"
    assert code_of(mcq(correctOptionId=None), request_for()) == "invalidAiOutputAnswerKey"


def test_rejects_a_multiple_choice_question_carrying_a_reference_answer() -> None:
    assert code_of(mcq(referenceAnswer="lộ đáp án"), request_for()) == "invalidAiOutputAnswerKey"


# ============================================================
# short-answer rules
# ============================================================

def test_rejects_a_short_answer_without_reference_answer() -> None:
    assert code_of(short_answer(referenceAnswer="   "), request_for("shortAnswer")) == "invalidAiOutputAnswerKey"


def test_rejects_a_short_answer_carrying_options() -> None:
    raw = short_answer(options=[
        {"optionId": "option-a", "text": "Một"},
        {"optionId": "option-b", "text": "Hai"},
    ])
    assert code_of(raw, request_for("shortAnswer")) == "invalidAiOutputOptions"


# ============================================================
# duplicates
# ============================================================

def test_rejects_duplicate_questions() -> None:
    question = json.loads(mcq())["questions"][0]
    raw = json.dumps({"questions": [question, {**question, "prompt": "  theo TRANSCRIPT, tcp làm gì?  "}]})
    assert code_of(raw, request_for()) == "invalidAiOutputDuplicate"
