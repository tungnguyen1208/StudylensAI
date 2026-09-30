# Backend Agent Rules

These rules apply when Codex starts inside `services/api`.

- Keep endpoints/controllers thin.
- Put business logic in the owning feature module under `src/StudyLens.Api/Features/**`.
- Backend is the only service that reads/writes application business data.
- Session Quiz validates and persists normalized full-video YouTube caption
  cues and capture metadata. It owns canonical content hashing, idempotency,
  retryable processing jobs, and quiz persistence; do not persist raw DOM,
  audio, or provider payloads.
- Do not create a generic repository or CQRS framework unless a concrete task requires it.
- FastAPI calls must go through module gateways or shared HTTP clients.
- Send FastAPI an immutable Backend-owned full transcript for full-video quiz
  generation or grading. The only exception is the Backend-requested Gemini
  fallback, where FastAPI receives a public YouTube URL and returns structured
  timestamped cues.
- Entity configuration belongs in the owning module; `StudyLensDbContext` discovers configuration by assembly scanning.
- Run `dotnet build services/api/src/StudyLens.Api/StudyLens.Api.csproj` and the relevant module test project.
