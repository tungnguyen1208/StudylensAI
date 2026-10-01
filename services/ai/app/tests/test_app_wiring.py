from app.main import app


def test_v05_registers_only_supported_ai_routes() -> None:
    routes = set(app.openapi()["paths"])

    assert "/api/ai/question-generation/generate" in routes
    assert "/api/ai/transcripts/generate" in routes
    assert "/api/ai/grading/short-answer" in routes
    assert "/api/ai/classification" not in routes
