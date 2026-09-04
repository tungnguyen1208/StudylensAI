# Prompt — Bootstrap StudyLens Base Repository Architecture

Use this prompt with Codex at the root of a new StudyLens repository.

---

You are working on **StudyLens AI**, a Chrome/Edge browser extension that supports active learning on YouTube Web by creating quizzes from video transcripts.

Before making any change:

1. Read `AGENTS.md` completely.
2. Treat `AGENTS.md` as the architecture and development rulebook.
3. Do not implement full product features yet.
4. This task is only to create the **base repository architecture / walking skeleton** that future feature modules will build on.

## Goal

Create a clean, minimal **monorepo base structure** for StudyLens with three executable components:

```text
Chrome/Edge Extension
        ↓ HTTP
ASP.NET Core 8 Web API
        ↓ HTTP
FastAPI AI Service
```

The Backend should also have a basic SQLite-ready EF Core setup.

The purpose is to prove the architecture can run end-to-end before implementing StudyLens business features.

---

## Required Repository Structure

Create or normalize the repository toward:

```text
studylens/
├── AGENTS.md
├── README.md
├── .gitignore
├── .editorconfig
├── .env.example
│
├── apps/
│   └── extension/
│
├── services/
│   ├── api/
│   └── ai-service/
│
├── docs/
│   ├── api-contracts/
│   ├── architecture/
│   └── test-data/
│
├── scripts/
│
└── docker/
```

Do not create unnecessary services.

Do not introduce:

- Kafka
- RabbitMQ
- Redis
- Kubernetes
- Vector Database
- CQRS
- event sourcing
- complex repository/unit-of-work abstractions

unless explicitly requested later.

---

# 1. Extension Base

Under:

```text
apps/extension/
```

set up a minimal:

- TypeScript
- React
- Vite
- Manifest V3

Chrome/Edge extension.

Recommended source structure:

```text
apps/extension/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── content/
    │   └── youtube-detector.ts
    │
    ├── background/
    │   └── service-worker.ts
    │
    ├── sidepanel/
    │   ├── App.tsx
    │   └── main.tsx
    │
    ├── features/
    │   ├── activation/
    │   ├── session/
    │   ├── quiz/
    │   ├── history/
    │   └── settings/
    │
    ├── api/
    │   └── api-client.ts
    │
    └── models/
```

For this bootstrap task:

- the Side Panel only needs a basic StudyLens title/status UI
- `youtube-detector.ts` may expose a minimal function to determine whether the current page is a YouTube watch page
- do not implement full transcript extraction
- do not implement full timer logic
- do not implement quiz UI yet

Create an API client capable of calling:

```text
GET {BACKEND_URL}/api/health
```

Backend URL must come from configuration, not be scattered across components.

---

# 2. ASP.NET Core Backend Base

Under:

```text
services/api/
```

create an ASP.NET Core 8 Web API.

Use:

- C#
- ASP.NET Core 8
- Entity Framework Core
- SQLite
- Swagger/OpenAPI

Preferred structure:

```text
services/api/
├── Controllers/
│   └── HealthController.cs
│
├── Features/
│   ├── Videos/
│   ├── Sessions/
│   ├── Quizzes/
│   ├── History/
│   └── Settings/
│
├── AI/
│   └── AIServiceClient.cs
│
├── Data/
│   ├── StudyLensDbContext.cs
│   ├── Entities/
│   └── Migrations/
│
├── Common/
│   ├── Exceptions/
│   ├── Validation/
│   └── Responses/
│
├── appsettings.json
├── appsettings.Development.json
└── Program.cs
```

For this bootstrap task implement:

```text
GET /api/health
```

Response example:

```json
{
  "status": "ok",
  "service": "studylens-api"
}
```

Create `AIServiceClient` with only the minimum functionality required to call:

```text
GET {AI_SERVICE_URL}/health
```

Do not implement classification, quiz generation, or grading yet.

Configure:

- CORS for local extension development
- Swagger
- HttpClient for FastAPI
- EF Core SQLite
- configuration binding
- basic exception-safe startup

Do not over-engineer the application architecture.

---

# 3. FastAPI AI Service Base

Under:

```text
services/ai-service/
```

create a Python FastAPI application.

Preferred structure:

```text
services/ai-service/
├── requirements.txt
├── pyproject.toml
└── app/
    ├── main.py
    │
    ├── api/
    │   ├── health.py
    │   ├── classification.py
    │   ├── questions.py
    │   └── grading.py
    │
    ├── services/
    │   ├── classifier.py
    │   ├── transcript_processor.py
    │   ├── question_generator.py
    │   └── grader.py
    │
    ├── schemas/
    │   ├── classification.py
    │   ├── question.py
    │   └── grading.py
    │
    ├── prompts/
    │   ├── classification.txt
    │   ├── question_generation.txt
    │   └── grading.txt
    │
    ├── llm/
    │   ├── client.py
    │   └── providers/
    │
    └── core/
        ├── config.py
        └── logging.py
```

For this bootstrap task:

Implement only:

```text
GET /health
```

Response example:

```json
{
  "status": "ok",
  "service": "studylens-ai-service"
}
```

The AI module folders may contain minimal placeholders/interfaces where necessary, but do not implement actual LLM prompts or model calls yet.

Create a minimal `LLMClient` abstraction/interface that future Cloud LLM or vLLM providers can implement.

Do not bind the architecture to one model vendor.

---

# 4. Base Database Setup

Configure ASP.NET Core EF Core with SQLite.

Create a minimal `StudyLensDbContext`.

Do not create the full production schema yet unless required for the application to start.

If a base entity is necessary, keep it minimal.

Future entities will include:

```text
User
Video
StudySession
TranscriptSegment
Question
Answer
```

But do not prematurely implement complex relationships during this bootstrap task.

---

# 5. API Contract Documentation

Create:

```text
docs/api-contracts/health.md
```

Document:

```text
GET /api/health
GET /health
```

Include:

- caller
- target service
- request
- response
- status codes
- example JSON

Also create:

```text
docs/api-contracts/README.md
```

with the rule:

> Any API contract used between Extension, ASP.NET Backend, and FastAPI must be documented here before or together with implementation.

---

# 6. Architecture Documentation

Create:

```text
docs/architecture/README.md
```

Include the base architecture:

```text
YouTube Web
    ↓
Chrome/Edge Extension
    ↓ HTTP REST
ASP.NET Core Backend
    ├── SQLite
    ↓
FastAPI AI Service
    ↓
LLM Provider
```

Clearly document ownership:

### Extension

- YouTube integration
- Side Panel UI
- session/client-side video state
- player control

### ASP.NET Backend

- application logic
- persistence
- session/history/settings
- AI orchestration

### FastAPI

- transcript processing
- classification
- question generation
- short-answer grading
- AI output validation

### LLM provider

- model inference only

---

# 7. Environment Configuration

Create `.env.example` or appropriate configuration examples with placeholders only.

Expected configuration concepts:

```text
BACKEND_URL
AI_SERVICE_URL
LLM_PROVIDER
LLM_API_KEY
LLM_BASE_URL
DATABASE_CONNECTION
```

Do not put any real secrets in the repository.

Extension must never receive `LLM_API_KEY`.

---

# 8. Local Development Commands

Update root `README.md` with explicit commands for running each component independently.

Document:

### Extension

```text
install dependencies
run dev/build
load unpacked extension
```

### ASP.NET Backend

```text
restore
run
```

### FastAPI

```text
create virtual environment
install dependencies
run uvicorn
```

Use actual commands matching the files you generate.

Do not write commands that are not valid for the created project.

---

# 9. Walking Skeleton Acceptance Criteria

The bootstrap task is DONE when all of the following are true:

1. Extension project installs/builds successfully.
2. Side Panel renders a simple StudyLens screen.
3. ASP.NET Core Backend starts successfully.
4. FastAPI AI Service starts successfully.
5. Backend exposes:

```text
GET /api/health
```

6. FastAPI exposes:

```text
GET /health
```

7. Backend can call FastAPI health through `AIServiceClient`.
8. Extension can call Backend health through `api-client`.
9. Swagger works for the ASP.NET API.
10. SQLite configuration is valid.
11. No secrets are committed.
12. Project structure follows `AGENTS.md`.
13. No real StudyLens business feature is implemented prematurely.

The final proof should be this path:

```text
Extension
   ↓
ASP.NET Core Backend
   ↓
FastAPI AI Service
```

working locally.

---

# 10. Implementation Constraints

While working:

- Do not rewrite `AGENTS.md`.
- Do not change the agreed technology stack.
- Do not add advanced infrastructure.
- Keep controllers thin.
- Keep external AI HTTP code inside `AIServiceClient`.
- Keep Extension HTTP calls behind `api-client`.
- Keep FastAPI routes thin and place future AI logic in services.
- Prefer simple, readable code.
- Add comments only where they explain a non-obvious design decision.
- Avoid placeholder pseudo-code in files that are expected to compile/run.
- If a placeholder module is created for future work, make it syntactically valid and clearly marked.

---

# 11. Verification Before Finishing

Before reporting completion:

1. Inspect the final directory tree.
2. Build the Extension.
3. Build/run or compile-check the ASP.NET project.
4. Import/start-check the FastAPI application.
5. Verify the documented commands match the actual project.
6. Check for accidentally committed secrets.
7. List any item that could not be verified.

Do not claim something works unless you have run the relevant local verification command when the environment allows it.

At the end, provide:

1. final directory tree
2. files created
3. commands to run each service
4. health endpoints
5. known limitations
6. next recommended feature: **M1 Video & Activation**

Do not proceed to M1 unless explicitly asked.
