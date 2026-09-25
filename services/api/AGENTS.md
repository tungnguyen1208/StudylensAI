# Backend Agent Rules

These rules apply when Codex starts inside `services/api`.

- Keep endpoints/controllers thin.
- Put business logic in the owning feature module under `src/StudyLens.Api/Features/**`.
- Backend is the only service that reads/writes application business data.
- Video Activation validates and persists only normalized YouTube caption cues
  and capture metadata. It owns canonical content hashing and idempotency;
  do not persist raw DOM, audio, or provider payloads.
- Do not create a generic repository or CQRS framework unless a concrete task requires it.
- FastAPI calls must go through module gateways or shared HTTP clients.
- Send FastAPI only an immutable, Backend-frozen transcript segment for quiz
  generation or grading. Backend, not FastAPI, owns transcript acquisition.
- Entity configuration belongs in the owning module; `StudyLensDbContext` discovers configuration by assembly scanning.
- Run `dotnet build services/api/src/StudyLens.Api/StudyLens.Api.csproj` and the relevant module test project.
