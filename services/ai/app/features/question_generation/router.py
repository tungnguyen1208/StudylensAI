from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator

router = APIRouter(prefix="/api/ai/question-generation", tags=["Question Generation (Dev 2)"])

class TranscriptCue(BaseModel):
    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)
    text: str = Field(min_length=1)

    @model_validator(mode="after")
    def end_must_follow_start(self):
        if self.endMs <= self.startMs:
            raise ValueError("endMs must be greater than startMs")
        return self


class QuestionGenerationRequest(BaseModel):
    contractVersion: str
    promptVersion: str
    segmentId: str
    youtubeVideoId: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)
    questionType: str
    difficulty: str
    cues: list[TranscriptCue] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_versions_and_range(self):
        if self.contractVersion != "0.2.0" or self.promptVersion != "0.2.0":
            raise ValueError("unsupported contract or prompt version")
        if self.endMs <= self.startMs:
            raise ValueError("endMs must be greater than startMs")
        if self.questionType not in {"multipleChoice", "shortAnswer"}:
            raise ValueError("unsupported questionType")
        if self.difficulty not in {"easy", "medium", "hard"}:
            raise ValueError("unsupported difficulty")
        return self


class GeneratedOption(BaseModel):
    optionId: str
    text: str


class GeneratedQuestion(BaseModel):
    type: str
    prompt: str
    options: list[GeneratedOption] | None = None
    correctOptionId: str | None = None
    referenceAnswer: str | None = None
    sourceStartMs: int
    sourceEndMs: int


class QuestionGenerationResponse(BaseModel):
    contractVersion: str = "0.2.0"
    promptVersion: str = "0.2.0"
    questions: list[GeneratedQuestion]


@router.post("/generate", response_model=QuestionGenerationResponse)
async def generate_questions(request: QuestionGenerationRequest) -> QuestionGenerationResponse:
    """Deterministic fake provider for the Week 1 integration demo; no network or LLM key."""
    first_cue = request.cues[0]
    if request.questionType == "multipleChoice":
        question = GeneratedQuestion(
            type="multipleChoice",
            prompt=f"Theo transcript, ý chính của đoạn '{first_cue.text}' là gì?",
            options=[
                GeneratedOption(optionId="option-a", text=first_cue.text),
                GeneratedOption(optionId="option-b", text="Một chi tiết không xuất hiện trong đoạn học"),
                GeneratedOption(optionId="option-c", text="Một kết luận không có bằng chứng"),
            ],
            correctOptionId="option-a",
            sourceStartMs=first_cue.startMs,
            sourceEndMs=first_cue.endMs,
        )
    else:
        question = GeneratedQuestion(
            type="shortAnswer",
            prompt="Hãy tóm tắt ý chính của đoạn transcript bằng lời của bạn.",
            referenceAnswer=first_cue.text,
            sourceStartMs=first_cue.startMs,
            sourceEndMs=first_cue.endMs,
        )
    return QuestionGenerationResponse(questions=[question])
