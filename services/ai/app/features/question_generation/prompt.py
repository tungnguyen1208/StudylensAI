import json

from app.features.question_generation.schemas import QuestionGenerationRequest

PROMPT_VERSION = "0.5.0"

EVIDENCE_OPEN = "<<<EVIDENCE"
EVIDENCE_CLOSE = "EVIDENCE>>>"

_INSTRUCTIONS = """You generate study questions for StudyLens.
Rules:
1. Use only the transcript evidence provided below. Never add outside knowledge.
2. Keep every sourceStartMs/sourceEndMs inside the supplied full-video transcript range.
3. multipleChoice needs at least 3 distinct options, plausible distractors and one correctOptionId that exists.
4. shortAnswer needs a referenceAnswer grounded in the evidence.
5. Give every question a concise explanation grounded in the cited transcript cue.
6. Generate the requested questionCount without repeating a question.
7. Answer with JSON only, matching: {"questions": [...]}
"""


# ============================================================
# prompt building
# ============================================================

def build_prompt(request: QuestionGenerationRequest) -> str:
    evidence = {
        "sessionId": request.sessionId,
        "transcriptCaptureId": request.transcriptCaptureId,
        "youtubeVideoId": request.youtubeVideoId,
        "startMs": request.startMs,
        "endMs": request.endMs,
        "questionCount": request.questionCount,
        "questionType": request.questionType,
        "difficulty": request.difficulty,
        "cues": [cue.model_dump() for cue in request.cues],
    }
    return (
        f"{_INSTRUCTIONS}\n"
        f"promptVersion: {PROMPT_VERSION}\n"
        f"{EVIDENCE_OPEN}{json.dumps(evidence, ensure_ascii=False)}{EVIDENCE_CLOSE}\n"
    )


def read_evidence(prompt: str) -> dict:
    """Reads back the evidence block so an offline provider can answer from the prompt alone."""
    start = prompt.find(EVIDENCE_OPEN)
    end = prompt.find(EVIDENCE_CLOSE, start)
    if start == -1 or end == -1:
        raise ValueError("prompt carries no evidence block")
    return json.loads(prompt[start + len(EVIDENCE_OPEN):end])
