from enum import StrEnum

from pydantic import BaseModel, Field


class Classification(str, StrEnum):
    educational = "educational"
    non_educational = "non_educational"
    unknown = "unknown"


class ClassificationResult(BaseModel):
    classification: Classification
    confidence: float = Field(ge=0, le=1)

