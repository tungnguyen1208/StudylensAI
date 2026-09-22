import json

from app.features.question_generation.prompt import read_evidence

MIN_EVIDENCE_CHARS = 40


class InsufficientEvidenceError(Exception):
    """Raised when the transcript evidence cannot support a grounded question."""


# ============================================================
# deterministic offline provider
# ============================================================

class DeterministicQuestionProvider:
    """Satisfies the LlmProvider protocol without network access or an API key."""

    async def generate(self, prompt: str) -> str:
        evidence = read_evidence(prompt)
        cues = evidence["cues"]
        joined = " ".join(cue["text"].strip() for cue in cues).strip()
        if len(joined) < MIN_EVIDENCE_CHARS:
            raise InsufficientEvidenceError("transcript evidence is too short for a grounded question")

        anchor = cues[0]
        if evidence["questionType"] == "multipleChoice":
            question = {
                "type": "multipleChoice",
                "prompt": f"Theo transcript, ý chính của đoạn '{_shorten(anchor['text'])}' là gì?",
                "options": [
                    {"optionId": "option-a", "text": _shorten(anchor["text"])},
                    {"optionId": "option-b", "text": "Một chi tiết không xuất hiện trong đoạn học"},
                    {"optionId": "option-c", "text": "Một kết luận không có bằng chứng trong transcript"},
                ],
                "correctOptionId": "option-a",
                "sourceStartMs": anchor["startMs"],
                "sourceEndMs": anchor["endMs"],
            }
        else:
            question = {
                "type": "shortAnswer",
                "prompt": "Hãy tóm tắt ý chính của đoạn transcript bằng lời của bạn.",
                "referenceAnswer": _shorten(joined, limit=240),
                "sourceStartMs": anchor["startMs"],
                "sourceEndMs": cues[-1]["endMs"],
            }

        return json.dumps({"questions": [question]}, ensure_ascii=False)


def _shorten(value: str, limit: int = 120) -> str:
    text = " ".join(value.split())
    return text if len(text) <= limit else f"{text[: limit - 1].rstrip()}…"
