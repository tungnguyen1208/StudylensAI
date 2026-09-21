import asyncio

from app.features.question_generation.router import QuestionGenerationRequest, TranscriptCue, generate_questions, router
from app.features.grading.router import ShortAnswerGradeRequest, grade_short_answer, router as grading_router


def test_question_generation_router_keeps_the_dev2_contract_prefix() -> None:
    assert router.prefix == "/api/ai/question-generation"


def test_fake_provider_generates_valid_multiple_choice_question() -> None:
    request = QuestionGenerationRequest(
        contractVersion="0.2.0", promptVersion="0.2.0", segmentId="11111111-1111-4111-8111-111111111111",
        youtubeVideoId="dQw4w9WgXcQ", startMs=0, endMs=10_000, questionType="multipleChoice", difficulty="easy",
        cues=[TranscriptCue(startMs=0, endMs=10_000, text="TCP/IP describes how network data is routed.")],
    )

    response = asyncio.run(generate_questions(request))

    question = response.questions[0]
    assert question.correctOptionId == "option-a"
    assert question.options is not None
    assert any(option.optionId == question.correctOptionId for option in question.options)


def test_deterministic_short_answer_grading_never_uses_an_llm() -> None:
    request = ShortAnswerGradeRequest(
        questionId="11111111-1111-4111-8111-111111111111",
        prompt="Tóm tắt đoạn học.", referenceAnswer="TCP IP routes network data", answerText="tcp ip routes network data",
    )

    response = asyncio.run(grade_short_answer(request))

    assert grading_router.prefix == "/api/ai/grading"
    assert response.outcome == "correct"
    assert response.score == 1.0
