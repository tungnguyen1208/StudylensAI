import asyncio

from app.features.question_generation.router import QuestionGenerationRequest, TranscriptCue, generate_questions, router


def test_question_generation_router_keeps_the_dev2_contract_prefix() -> None:
    assert router.prefix == "/api/ai/question-generation"


def test_fake_provider_generates_valid_multiple_choice_question() -> None:
    request = QuestionGenerationRequest(
        contractVersion="0.1.0", promptVersion="0.1.0", segmentId="11111111-1111-4111-8111-111111111111",
        youtubeVideoId="dQw4w9WgXcQ", startMs=0, endMs=10_000, questionType="multipleChoice", difficulty="easy",
        cues=[TranscriptCue(startMs=0, endMs=10_000, text="TCP/IP describes how network data is routed.")],
    )

    response = asyncio.run(generate_questions(request))

    question = response.questions[0]
    assert question.correctOptionId == "option-a"
    assert question.options is not None
    assert any(option.optionId == question.correctOptionId for option in question.options)
