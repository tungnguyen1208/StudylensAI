# Common Dev Rules

`AGENTS.md` is the highest-priority rulebook for this repository. This file is
the daily checklist for Dev 1, Dev 2, Dev 3, and their Codex sessions.

## Read Order

1. Root `AGENTS.md`.
2. Closest nested `AGENTS.md` for the folder being edited.
3. `.agents/rules/common-dev-rules.md`.
4. The assigned role file in `.agents/rules/dev/`.
5. Related contracts in `contracts/`.
6. Existing code inside the owned module.

## System Boundary

```text
YouTube Web
    -> Browser Extension
    -> ASP.NET Core Backend
    -> FastAPI AI Service
    -> LLM Provider
```

Rules:

- Extension calls only the ASP.NET Core Backend.
- Extension never calls FastAPI or an LLM provider directly.
- Extension never contains LLM API keys, database secrets, or private prompts.
- Backend owns business persistence and orchestration.
- FastAPI is stateless and validates AI output before returning it.
- Backend and AI failures must not break YouTube playback.

## Contract Baseline

Current contract version: `0.1.0`.

Shared API rules:

- JSON fields use `camelCase`.
- Enums are strings.
- Video timestamps use integer milliseconds.
- System timestamps use ISO-8601 UTC.
- Public Extension responses must not expose correct answers or grading rubrics before answer submit.
- Mutations that can be retried need an idempotency key such as `clientRequestId`, `clientSegmentId`, or `clientAttemptId`.

## HOT Files

Only edit these files in an explicit integration task:

```text
AGENTS.md
README.md
.agents/**
.codex/**
apps/extension/manifest.json
apps/extension/vite.config.ts
apps/extension/src/shell/**
apps/extension/src/shared/**
apps/extension/src/generated/**
services/api/StudyLens.sln
services/api/src/StudyLens.Api/Program.cs
services/api/src/StudyLens.Api/BuildingBlocks/**
services/api/src/StudyLens.Api/Infrastructure/Persistence/StudyLensDbContext.cs
services/api/src/StudyLens.Api/Infrastructure/Persistence/Migrations/**
services/ai/app/main.py
services/ai/app/platform/**
contracts/public-api/root.yaml
contracts/ai-api/root.yaml
deploy/**
.github/workflows/**
package-lock.json
```

If a feature task must touch a HOT file, write down why, which module is
affected, which contract changed, and which verification commands were run.

## Pre-PR Checklist

- Am I editing only my owned module or an approved HOT file?
- Did I update contracts before implementation when an API changed?
- Did I keep Extension -> Backend -> AI direction intact?
- Did I avoid direct imports into another module's repositories/services?
- Did I keep secrets out of the repository and Extension bundle?
- Did I add tests in the owned module?
- Did I run the smallest relevant build/test commands?
