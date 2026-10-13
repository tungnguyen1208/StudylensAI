import json

import pytest

from app.features.question_generation.output_validator import InvalidAiOutputError, validate_chunk_output, validate_output
from app.features.question_generation.schemas import QuestionGenerationRequest

# ============================================================
# helpers
# ============================================================

def request_for(question_type: str = "multipleChoice") -> QuestionGenerationRequest:
    return QuestionGenerationRequest(
        contractVersion="0.5.0",
        promptVersion="0.5.1",
        sessionId="11111111-1111-4111-8111-111111111111",
        transcriptCaptureId="22222222-2222-4222-8222-222222222222",
        youtubeVideoId="dQw4w9WgXcQ",
        videoTitle="How TCP reliably transfers ordered data",
        startMs=0,
        endMs=300_000,
        questionCount=3,
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
        "explanation": "Grounded in the cited transcript cue.",
        "sourceStartCueIndex": 0,
        "sourceEndCueIndex": 0,
    }
    question.update(overrides)
    return json.dumps({"questions": [question]})


def short_answer(**overrides) -> str:
    question = {
        "type": "shortAnswer",
        "prompt": "Tóm tắt vai trò của TCP.",
        "referenceAnswer": "TCP chia dữ liệu thành các segment có thứ tự.",
        "explanation": "Grounded in the cited transcript cue.",
        "sourceStartCueIndex": 0,
        "sourceEndCueIndex": 0,
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

    assert response.contractVersion == "0.5.0"
    assert response.promptVersion == "0.5.1"
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


def test_allows_empty_internal_chunk_but_not_missing_question_list() -> None:
    assert validate_chunk_output('{"questions": []}', request_for()) == []
    with pytest.raises(InvalidAiOutputError):
        validate_chunk_output('{"other": 1}', request_for())


def test_rejects_a_question_missing_required_fields() -> None:
    raw = json.dumps({"questions": [{"type": "multipleChoice", "prompt": "Thiếu source"}]})
    assert code_of(raw, request_for()) == "invalidAiOutputSchema"


def test_rejects_a_question_type_the_request_did_not_ask_for() -> None:
    assert code_of(short_answer(), request_for("multipleChoice")) == "invalidAiOutputType"


# ============================================================
# timestamp rules
# ============================================================

def test_rejects_a_source_cue_index_outside_the_supplied_cues() -> None:
    assert code_of(mcq(sourceStartCueIndex=1, sourceEndCueIndex=1), request_for()) == "invalidAiOutputTimestamp"


def test_rejects_a_backwards_source_cue_range() -> None:
    request = QuestionGenerationRequest.model_validate(
        {**request_for().model_dump(), "cues": [
            {"startMs": 0, "endMs": 30_000, "text": "First cue."},
            {"startMs": 30_000, "endMs": 60_000, "text": "Second cue."},
        ]}
    )
    assert code_of(mcq(sourceStartCueIndex=1, sourceEndCueIndex=0), request) == "invalidAiOutputTimestamp"


def test_exact_cue_timestamp_passes_ai_validation_even_when_caption_cues_overlap() -> None:
    request = QuestionGenerationRequest.model_validate(
        {
            **request_for().model_dump(),
            "cues": [
                {"startMs": 65_000, "endMs": 66_000, "text": "The first caption."},
                {"startMs": 65_000, "endMs": 70_000, "text": "The extended caption."},
                {"startMs": 66_000, "endMs": 71_000, "text": "The next caption."},
            ],
        }
    )

    response = validate_output(mcq(sourceStartCueIndex=0, sourceEndCueIndex=0), request)

    assert len(response.questions) == 1
    assert (response.questions[0].sourceStartMs, response.questions[0].sourceEndMs) == (65_000, 66_000)


def test_multi_cue_evidence_may_use_boundaries_from_different_overlapping_cues() -> None:
    request = QuestionGenerationRequest.model_validate(
        {**request_for().model_dump(), "cues": [
            {"startMs": 65_000, "endMs": 66_000, "text": "The first caption."},
            {"startMs": 65_000, "endMs": 70_000, "text": "The extended caption."},
            {"startMs": 66_000, "endMs": 71_000, "text": "The next caption."},
        ]}
    )

    response = validate_output(mcq(sourceStartCueIndex=0, sourceEndCueIndex=2), request)

    assert (response.questions[0].sourceStartMs, response.questions[0].sourceEndMs) == (65_000, 71_000)


@pytest.mark.parametrize("start_index,end_index", [(0, 2), (1, 0), (2, 2)])
def test_rejects_invalid_provider_cue_indexes(start_index: int, end_index: int) -> None:
    request = QuestionGenerationRequest.model_validate(
        {**request_for().model_dump(), "cues": [
            {"startMs": 65_000, "endMs": 66_000, "text": "The first caption."},
            {"startMs": 65_000, "endMs": 70_000, "text": "The extended caption."},
        ]}
    )

    assert code_of(mcq(sourceStartCueIndex=start_index, sourceEndCueIndex=end_index), request) == "invalidAiOutputTimestamp"


def test_provider_cannot_return_arbitrary_timestamps_instead_of_cue_indexes() -> None:
    question = json.loads(mcq())["questions"][0]
    question.pop("sourceStartCueIndex")
    question.pop("sourceEndCueIndex")
    question["sourceStartMs"] = 12_345
    question["sourceEndMs"] = 23_456

    assert code_of(json.dumps({"questions": [question]}), request_for()) == "invalidAiOutputSchema"


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
