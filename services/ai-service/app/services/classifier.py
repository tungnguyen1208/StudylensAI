from app.schemas.classification import Classification, ClassificationResult


class Classifier:
    async def classify_placeholder(self) -> ClassificationResult:
        return ClassificationResult(classification=Classification.unknown, confidence=0)

