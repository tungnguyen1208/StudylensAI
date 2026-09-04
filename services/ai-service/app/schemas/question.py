from enum import StrEnum

from pydantic import BaseModel


class QuestionType(str, StrEnum):
    multiple_choice = "multiple_choice"
    short_answer = "short_answer"


class QuizQuestion(BaseModel):
    id: str
    segmentId: str
    type: QuestionType
    content: str
    options: list[str] | None = None
    correctAnswer: str
    explanation: str
    timestamp: float

