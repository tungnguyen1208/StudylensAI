import json

from pydantic import ValidationError

from app.features.question_generation.schemas import (
    GeneratedQuestion,
    QuestionGenerationRequest,
    QuestionGenerationResponse,
)


class InvalidAiOutputError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ============================================================
# validation entry point
# ============================================================

def validate_output(raw: str, request: QuestionGenerationRequest) -> QuestionGenerationResponse:
    payload = _parse(raw)
    questions = payload.get("questions")
    if not isinstance(questions, list) or len(questions) == 0:
        raise InvalidAiOutputError("invalidAiOutput", "The provider returned no question.")

    validated = [_validate_question(item, request) for item in questions]
    _reject_duplicate_prompts(validated)
    return QuestionGenerationResponse(questions=validated)


# ============================================================
# internals
# ============================================================

def _parse(raw: str) -> dict:
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as error:
        raise InvalidAiOutputError("invalidAiOutputJson", "The provider returned malformed JSON.") from error
    if not isinstance(payload, dict):
        raise InvalidAiOutputError("invalidAiOutputJson", "The provider returned a non-object payload.")
    return payload


def _validate_question(item: object, request: QuestionGenerationRequest) -> GeneratedQuestion:
    try:
        question = GeneratedQuestion.model_validate(item)
    except ValidationError as error:
        raise InvalidAiOutputError("invalidAiOutputSchema", "A generated question does not match the schema.") from error

    if question.type != request.questionType:
        raise InvalidAiOutputError("invalidAiOutputType", "The generated question type does not match the request.")

    _validate_source_range(question, request)
    if question.type == "multipleChoice":
        _validate_multiple_choice(question)
    else:
        _validate_short_answer(question)
    return question


def _validate_source_range(question: GeneratedQuestion, request: QuestionGenerationRequest) -> None:
    if question.sourceEndMs <= question.sourceStartMs:
        raise InvalidAiOutputError("invalidAiOutputTimestamp", "sourceEndMs must be greater than sourceStartMs.")
    if question.sourceStartMs < request.startMs or question.sourceEndMs > request.endMs:
        raise InvalidAiOutputError("invalidAiOutputTimestamp", "The question source falls outside the study segment.")


def _validate_multiple_choice(question: GeneratedQuestion) -> None:
    options = question.options or []
    if len(options) < 2:
        raise InvalidAiOutputError("invalidAiOutputOptions", "A multiple-choice question needs at least two options.")

    option_ids = [option.optionId for option in options]
    normalized_texts = [" ".join(option.text.split()).casefold() for option in options]
    if len(set(option_ids)) != len(option_ids):
        raise InvalidAiOutputError("invalidAiOutputOptions", "Option identifiers must be unique.")
    if len(set(normalized_texts)) != len(normalized_texts):
        raise InvalidAiOutputError("invalidAiOutputOptions", "Option texts must be unique.")
    if not question.correctOptionId or question.correctOptionId not in option_ids:
        raise InvalidAiOutputError("invalidAiOutputAnswerKey", "correctOptionId must reference an existing option.")
    if question.referenceAnswer is not None:
        raise InvalidAiOutputError("invalidAiOutputAnswerKey", "A multiple-choice question must not carry a reference answer.")


def _validate_short_answer(question: GeneratedQuestion) -> None:
    if not question.referenceAnswer or not question.referenceAnswer.strip():
        raise InvalidAiOutputError("invalidAiOutputAnswerKey", "A short-answer question needs a reference answer.")
    if question.options or question.correctOptionId:
        raise InvalidAiOutputError("invalidAiOutputOptions", "A short-answer question must not carry options.")


def _reject_duplicate_prompts(questions: list[GeneratedQuestion]) -> None:
    prompts = [" ".join(question.prompt.split()).casefold() for question in questions]
    if len(set(prompts)) != len(prompts):
        raise InvalidAiOutputError("invalidAiOutputDuplicate", "The provider returned duplicate questions.")
