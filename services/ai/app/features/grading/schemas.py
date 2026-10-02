from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


CONTRACT_VERSION = "0.5.0"
GradeOutcome = Literal["correct", "incorrect", "partiallyCorrect"]


class ShortAnswerGradeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal["0.5.0"]
    questionId: str = Field(pattern=r"^[0-9a-fA-F-]{36}$")
    prompt: str = Field(min_length=1)
    referenceAnswer: str = Field(min_length=1)
    answerText: str = Field(min_length=1)

    @model_validator(mode="after")
    def text_must_not_be_blank(self) -> "ShortAnswerGradeRequest":
        if any(not value.strip() for value in (self.prompt, self.referenceAnswer, self.answerText)):
            raise ValueError("grading text fields must not be blank")
        return self


class ShortAnswerGradeDecision(BaseModel):
    """Provider-owned fields. The reference answer always comes from Backend."""

    model_config = ConfigDict(extra="forbid")

    outcome: GradeOutcome
    score: float = Field(ge=0, le=1)
    explanation: str = Field(min_length=1)

    @model_validator(mode="after")
    def explanation_must_not_be_blank(self) -> "ShortAnswerGradeDecision":
        if not self.explanation.strip():
            raise ValueError("explanation must not be blank")
        return self


class ShortAnswerGradeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: GradeOutcome
    score: float = Field(ge=0, le=1)
    referenceAnswer: str = Field(min_length=1)
    explanation: str = Field(min_length=1)


class AiErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    retryable: bool
