from app.main import app


def test_v12_registers_only_question_generation_and_grading_ai_routes() -> None:
    routes = {route.path for route in app.routes}

    assert "/api/ai/question-generation/generate" in routes
    assert "/api/ai/grading/short-answer" in routes
    assert "/api/ai/classification" not in routes
