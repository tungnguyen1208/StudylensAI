class TranscriptProcessor:
    def normalize_placeholder(self, content: str) -> str:
        return " ".join(content.split())

