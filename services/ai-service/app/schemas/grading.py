from pydantic import BaseModel, Field


class AnswerResult(BaseModel):
    questionId: str
    isCorrect: bool
    score: float = Field(ge=0, le=1)
    referenceAnswer: str
    explanation: str
    timestamp: float

