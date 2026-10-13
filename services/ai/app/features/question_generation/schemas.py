from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CONTRACT_VERSION = "0.5.0"
PROMPT_VERSION = "0.5.1"

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

    contractVersion: Literal["0.5.0"]
    promptVersion: Literal["0.5.1"]
    sessionId: str = Field(pattern=r"^[0-9a-fA-F-]{36}$")
    transcriptCaptureId: str = Field(pattern=r"^[0-9a-fA-F-]{36}$")
    youtubeVideoId: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    videoTitle: str = Field(min_length=1, max_length=512)
    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)
    questionCount: int = Field(ge=3, le=15)
    questionType: QuestionType
    difficulty: Difficulty
    cues: list[TranscriptCue] = Field(min_length=1)

    @field_validator("videoTitle")
    @classmethod
    def normalize_video_title(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("videoTitle must contain visible text")
        return normalized

    @model_validator(mode="after")
    def validate_versions_and_range(self) -> "QuestionGenerationRequest":
        if self.contractVersion != CONTRACT_VERSION:
            raise ValueError("unsupported contract version")
        if self.endMs <= self.startMs:
            raise ValueError("endMs must be greater than startMs")
        if any(cue.startMs < self.startMs or cue.endMs > self.endMs for cue in self.cues):
            raise ValueError("every cue must stay inside the full-video range")
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
    explanation: str = Field(min_length=1)
    sourceStartMs: int = Field(ge=0)
    sourceEndMs: int = Field(gt=0)


class QuestionGenerationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: str = CONTRACT_VERSION
    promptVersion: Literal["0.5.1"] = PROMPT_VERSION
    questions: list[GeneratedQuestion] = Field(min_length=1, max_length=15)


class ProviderGeneratedQuestion(BaseModel):
    """Provider-only shape; cue indexes are mapped to trusted timestamps locally."""
    model_config = ConfigDict(extra="forbid")

    type: QuestionType
    prompt: str = Field(min_length=1)
    options: list[GeneratedOption] | None = None
    correctOptionId: str | None = None
    referenceAnswer: str | None = None
    explanation: str = Field(min_length=1)
    sourceStartCueIndex: int = Field(ge=0)
    sourceEndCueIndex: int = Field(ge=0)


class ProviderQuestionGenerationChunkResponse(BaseModel):
    """Internal provider schema: one evidence chunk may support no questions."""
    model_config = ConfigDict(extra="forbid")

    questions: list[ProviderGeneratedQuestion] = Field(max_length=15)


# ============================================================
# errors
# ============================================================

class AiErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    retryable: bool
