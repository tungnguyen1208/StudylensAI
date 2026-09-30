import json

from app.features.question_generation.prompt import read_evidence
from app.platform.llm.provider import LlmProviderError

MIN_EVIDENCE_CHARS = 40


class InsufficientEvidenceError(Exception):
    """Raised when transcript evidence cannot support a grounded question."""


# Kept as the feature-level import point for provider-specific tests and router
# mappings. The implementation stays platform-neutral.
ProviderCallError = LlmProviderError


class DeterministicQuestionProvider:
    """Offline provider used by tests and local development without an API key."""

    async def generate(self, prompt: str) -> str:
        evidence = read_evidence(prompt)
        cues = evidence["cues"]
        joined = " ".join(cue["text"].strip() for cue in cues).strip()
        if len(joined) < MIN_EVIDENCE_CHARS:
            raise InsufficientEvidenceError("transcript evidence is too short for a grounded question")

        questions: list[dict] = []
        count = min(int(evidence["questionCount"]), 15)
        for index in range(count):
            anchor = cues[min(len(cues) - 1, (index * len(cues)) // count)]
            if evidence["questionType"] == "multipleChoice":
                question = {
                    "type": "multipleChoice",
                    "prompt": f"Câu {index + 1}: Theo transcript, nội dung chính tại mốc này là gì?",
                    "options": [
                        {"optionId": "option-a", "text": _shorten(anchor["text"])},
                        {"optionId": "option-b", "text": f"Chi tiết không xuất hiện trong nội dung {index + 1}"},
                        {"optionId": "option-c", "text": f"Kết luận không có bằng chứng {index + 1}"},
                    ],
                    "correctOptionId": "option-a",
                    "explanation": f"Đáp án được trích trực tiếp từ transcript tại {anchor['startMs']} ms.",
                    "sourceStartMs": anchor["startMs"],
                    "sourceEndMs": anchor["endMs"],
                }
            else:
                question = {
                    "type": "shortAnswer",
                    "prompt": f"Câu {index + 1}: Hãy tóm tắt nội dung transcript tại mốc này.",
                    "referenceAnswer": _shorten(anchor["text"], limit=240),
                    "explanation": "Câu trả lời cần bám sát transcript được tham chiếu.",
                    "sourceStartMs": anchor["startMs"],
                    "sourceEndMs": anchor["endMs"],
                }
            questions.append(question)

        return json.dumps({"questions": questions}, ensure_ascii=False)


def _shorten(value: str, limit: int = 120) -> str:
    text = " ".join(value.split())
    return text if len(text) <= limit else f"{text[: limit - 1].rstrip()}…"
