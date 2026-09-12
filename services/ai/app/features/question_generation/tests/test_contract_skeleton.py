from app.features.question_generation.router import router


def test_question_generation_router_keeps_the_dev2_contract_prefix() -> None:
    assert router.prefix == "/api/ai/question-generation"
