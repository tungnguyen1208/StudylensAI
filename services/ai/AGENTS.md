# AI Service Agent Rules

These rules apply when Codex starts inside `services/ai`.

- Keep FastAPI routers thin.
- Put AI business logic inside the owning feature folder under `app/features/**`.
- Validate all LLM output with Pydantic before returning it to Backend.
- Keep the service stateless; do not persist StudyLens business state here.
- Do not hardcode provider API keys.
- Keep provider-specific behavior behind `app/platform/llm/**`.
- Run `python -m pytest` when tests exist and `python -c "from app.main import app; print(app.title)"` after app wiring changes.
