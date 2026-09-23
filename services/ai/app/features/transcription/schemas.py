from pydantic import BaseModel, ConfigDict, Field, model_validator


class TranscriptionCue(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    start_ms: int = Field(ge=0, serialization_alias="startMs")
    end_ms: int = Field(gt=0, serialization_alias="endMs")
    text: str = Field(min_length=1)

    @model_validator(mode="after")
    def valid_range(self):
        if self.end_ms <= self.start_ms:
            raise ValueError("end_ms must be greater than start_ms")
        return self


class TranscriptionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    language: str = Field(min_length=2, max_length=16)
    cues: list[TranscriptionCue] = Field(min_length=1)
