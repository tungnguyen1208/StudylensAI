# AI Service Agent Rules

These rules apply when Codex starts inside `services/ai`.

- Keep FastAPI routers thin.
- Put AI business logic inside the owning feature folder under `app/features/**`.
- Validate all LLM output with Pydantic before returning it to Backend.
- Keep the service stateless; do not persist StudyLens business state here.
- FastAPI is not a YouTube caption/transcript acquisition service. It receives
  only a frozen cue segment from ASP.NET Core for quiz generation or grading.
- Do not add STT, tab audio capture, YouTube DOM access, or caption-provider
  credentials to this service for the 0.4.0 runtime.
- Do not hardcode provider API keys.
- Keep provider-specific behavior behind `app/platform/llm/**`.
- Run `python -m pytest` when tests exist and `python -c "from app.main import app; print(app.title)"` after app wiring changes.
