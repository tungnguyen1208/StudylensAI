from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CONTRACT_VERSION = "0.3.0"

QuestionType = Literal["multipleChoice", "shortAnswer"]
Difficulty = Literal["easy", "medium", "hard"]


# ============================================================
# request
# ============================================================

class TranscriptCue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)
    text: str = Field(min_length=1)

    @model_validator(mode="after")
    def end_must_follow_start(self) -> "TranscriptCue":
        if self.endMs <= self.startMs:
            raise ValueError("endMs must be greater than startMs")
        return self


class QuestionGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: str
    promptVersion: str
    segmentId: str
    youtubeVideoId: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)
    questionType: QuestionType
    difficulty: Difficulty
    cues: list[TranscriptCue] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_versions_and_range(self) -> "QuestionGenerationRequest":
        if self.contractVersion != CONTRACT_VERSION:
            raise ValueError("unsupported contract version")
        if self.endMs <= self.startMs:
            raise ValueError("endMs must be greater than startMs")
        if any(cue.startMs < self.startMs or cue.endMs > self.endMs for cue in self.cues):
            raise ValueError("every cue must stay inside the segment range")
        return self


# ============================================================
# response
# ============================================================

class GeneratedOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    optionId: str = Field(min_length=1)
    text: str = Field(min_length=1)


class GeneratedQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: QuestionType
    prompt: str = Field(min_length=1)
    options: list[GeneratedOption] | None = None
    correctOptionId: str | None = None
    referenceAnswer: str | None = None
    sourceStartMs: int = Field(ge=0)
    sourceEndMs: int = Field(gt=0)


class QuestionGenerationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: str = CONTRACT_VERSION
    promptVersion: str = CONTRACT_VERSION
    questions: list[GeneratedQuestion] = Field(min_length=1)


# ============================================================
# errors
# ============================================================

class AiErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    retryable: bool
