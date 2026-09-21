from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator

router = APIRouter(prefix="/api/ai/grading", tags=["Grading (Dev 3)"])


class ShortAnswerGradeRequest(BaseModel):
    questionId: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    referenceAnswer: str = Field(min_length=1)
    answerText: str = Field(min_length=1)

    @model_validator(mode="after")
    def answer_must_not_be_blank(self):
        if not self.answerText.strip():
            raise ValueError("answerText must not be blank")
        return self


class ShortAnswerGradeResponse(BaseModel):
    outcome: str
    score: float
    referenceAnswer: str
    explanation: str


def normalize(value: str) -> str:
    return " ".join(value.casefold().split())


@router.post("/short-answer", response_model=ShortAnswerGradeResponse)
async def grade_short_answer(request: ShortAnswerGradeRequest) -> ShortAnswerGradeResponse:
    """Deterministic local grading only; no external LLM or API key is used."""
    answer = normalize(request.answerText)
    reference = normalize(request.referenceAnswer)
    if answer == reference:
        return ShortAnswerGradeResponse(
            outcome="correct", score=1.0, referenceAnswer=request.referenceAnswer,
            explanation="Câu trả lời khớp với đáp án tham khảo.",
        )
    if answer in reference or reference in answer:
        return ShortAnswerGradeResponse(
            outcome="partiallyCorrect", score=0.5, referenceAnswer=request.referenceAnswer,
            explanation="Câu trả lời có liên quan nhưng chưa đầy đủ.",
        )
    return ShortAnswerGradeResponse(
        outcome="incorrect", score=0.0, referenceAnswer=request.referenceAnswer,
        explanation="Câu trả lời chưa khớp với nội dung transcript đã dùng để tạo bài kiểm tra.",
    )
