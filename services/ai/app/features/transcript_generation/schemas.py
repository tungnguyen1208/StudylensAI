from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CONTRACT_VERSION = "0.5.0"


class TranscriptGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal["0.5.0"]
    youtubeVideoId: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")


class GeneratedTranscriptCue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)
    text: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_time(self) -> "GeneratedTranscriptCue":
        if self.endMs <= self.startMs:
            raise ValueError("endMs must be greater than startMs")
        if not self.text.strip():
            raise ValueError("text must not be blank")
        return self


class TranscriptGenerationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal["0.5.0"] = CONTRACT_VERSION
    youtubeVideoId: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    source: Literal["geminiVideo"] = "geminiVideo"
    language: str = Field(min_length=2)
    durationMs: int | None = Field(default=None, ge=0)
    cues: list[GeneratedTranscriptCue] = Field(min_length=1)


class TranscriptProviderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str = Field(min_length=2)
    durationMs: int | None = Field(default=None, ge=0)
    cues: list[GeneratedTranscriptCue] = Field(min_length=1)


class AiErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    retryable: bool
