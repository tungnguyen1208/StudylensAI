# Module Ownership Matrix

This document defines the strict vertical ownership boundaries for StudyLens AI.
To prevent merge conflicts and architectural divergence, developers and Codex instances must only modify files within their assigned ownership areas.

The target v1.2 seam keeps the learner's global ON/OFF choice explicit: Dev 1 emits `ACTIVATION_DISABLED` only for an explicit OFF. While ON, Dev 1's controlled YouTube SPA transition coordinator emits `VIDEO_CONTEXT_CHANGED` for a supported video-ID change; Dev 2 closes the matching old session and waits for the replacement `ACTIVATION_ENABLED`. No module may add video classification or silently persist OFF.

---

## 1. Developer Ownership Table

| Developer | Vertical Slice | Extension Scope | Backend Scope | AI Service Scope | Contracts | Tests |
|---|---|---|---|---|---|---|
| **Dev 1** | **Persistent Activation & Content Acquisition** | `apps/extension/src/features/video-activation/**`<br>`apps/extension/src/platform/youtube/**` | — | — | `contracts/public-api/video-activation.yaml`<br>`contracts/extension-messages/video-activation.schema.json`<br>`contracts/examples/video-activation/**` | `services/api/tests/VideoActivation.Tests/**`<br>`tests/contract/video-activation/**`<br>`tests/e2e/video-activation/**` |
| **Dev 2** | **Study Session & Quiz Generation** | `apps/extension/src/features/session-quiz/**` | `services/api/src/StudyLens.Api/Features/SessionQuiz/**` | `services/ai/app/features/question_generation/**` | `contracts/public-api/session-quiz.yaml`<br>`contracts/ai-api/question-generation.yaml`<br>`contracts/extension-messages/session-quiz.schema.json`<br>`contracts/examples/session-quiz/**` | `services/api/tests/SessionQuiz.Tests/**`<br>`tests/contract/session-quiz/**`<br>`tests/e2e/session-quiz/**` |
| **Dev 3** | **Assessment, Grading & History** | `apps/extension/src/features/assessment-history/**` | `services/api/src/StudyLens.Api/Features/AssessmentHistory/**` | `services/ai/app/features/grading/**` | `contracts/public-api/assessment-history.yaml`<br>`contracts/ai-api/grading.yaml`<br>`contracts/extension-messages/assessment-history.schema.json`<br>`contracts/examples/assessment-history/**` | `services/api/tests/AssessmentHistory.Tests/**`<br>`tests/contract/assessment-history/**`<br>`tests/e2e/assessment-history/**` |

---

## 2. Shared & HOT Files (Integration Captain Ownership)

The following files represent shared architectural boundaries and entry points.
Developers 1, 2, and 3 must **not** edit these files during standard feature tasks without explicit integration coordination:

```text
AGENTS.md
README.md

# Extension Shared Boundaries
apps/extension/manifest.json
apps/extension/vite.config.ts
apps/extension/src/shell/**
apps/extension/src/shared/**
apps/extension/src/generated/**

# Backend Shared Boundaries
services/api/src/StudyLens.Api/Program.cs
services/api/src/StudyLens.Api/BuildingBlocks/**
services/api/src/StudyLens.Api/Infrastructure/Persistence/StudyLensDbContext.cs
services/api/src/StudyLens.Api/Infrastructure/Persistence/Migrations/**
services/api/StudyLens.sln

# AI Service Shared Boundaries
services/ai/app/main.py
services/ai/app/platform/**

# Contract Roots
contracts/public-api/root.yaml
contracts/ai-api/root.yaml

# Deployment & CI/CD
deploy/**
.github/workflows/**
package-lock.json
```
