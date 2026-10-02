import json

from app.features.grading.prompt import read_evidence


class DeterministicGradingProvider:
    """Offline provider used by tests and local development."""

    async def generate(self, prompt: str) -> str:
        evidence = read_evidence(prompt)
        answer = _normalize(evidence["learnerAnswer"])
        reference = _normalize(evidence["referenceAnswer"])
        if answer == reference:
            decision = {
                "outcome": "correct",
                "score": 1.0,
                "explanation": "Câu trả lời phù hợp đầy đủ với đáp án tham khảo.",
            }
        elif answer and (answer in reference or reference in answer):
            decision = {
                "outcome": "partiallyCorrect",
                "score": 0.5,
                "explanation": "Câu trả lời đúng một phần nhưng chưa bao quát đầy đủ ý chính.",
            }
        else:
            decision = {
                "outcome": "incorrect",
                "score": 0.0,
                "explanation": "Câu trả lời chưa thể hiện đúng ý chính của đáp án tham khảo.",
            }
        return json.dumps(decision, ensure_ascii=False)


def _normalize(value: str) -> str:
    return " ".join(value.casefold().split())
