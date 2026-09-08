# AGENTS.md — StudyLens AI

## 1. Project Overview

**StudyLens AI** is a Chrome/Edge browser extension that helps users learn actively from YouTube Web videos.

The MVP flow is:

```text
YouTube Video
    ↓
Extension detects video + reads transcript
    ↓
Study Session starts
    ↓
Track actual watched time
    ↓
Create Transcript Segment
    ↓
ASP.NET Core Backend
    ↓
FastAPI AI Service
    ↓
LLM / vLLM / Cloud LLM
    ↓
Generate Quiz
    ↓
User answers in Side Panel
    ↓
Grade + Explain
    ↓
Review related timestamp
    ↓
Persist learning history
```

StudyLens MVP supports **YouTube Web only**.

Do not add support for Udemy, Coursera, or other platforms unless explicitly requested.

---

## 2. MVP Scope

Core MVP capabilities:

1. Detect the current YouTube video.
2. Collect video metadata:
   - videoId
   - URL
   - title
   - duration
   - current timestamp
   - play/pause state
3. Support Activation Mode:
   - Auto
   - Manual
4. In Auto mode, classify whether the video is educational.
5. Allow user ON/OFF override at all times.
6. Read an available valid transcript/subtitle.
7. Preserve transcript timestamps.
8. Track actual watched time.
9. Do not count paused time toward learning interval.
10. Support quiz intervals:
    - 5 minutes
    - 10 minutes
    - 15 minutes
11. Create transcript segments corresponding to learned content.
12. Generate:
    - Multiple Choice questions
    - Short Answer questions
13. Grade answers.
14. Provide short explanations.
15. Associate quiz/questions with transcript/timestamp evidence.
16. Allow seeking the YouTube player to the related timestamp.
17. Persist:
    - study sessions
    - transcript segments
    - questions
    - answers
    - learning results/history
18. Support basic settings.
19. Handle Backend/AI failures without breaking YouTube.

---

## 3. Technology Stack

### Browser Extension

- Chrome / Microsoft Edge
- Manifest V3
- TypeScript
- React
- Vite

### Main Backend

- ASP.NET Core 8 Web API
- C#
- Entity Framework Core
- Swagger / OpenAPI

### AI Service

- Python 3.12+
- FastAPI
- Uvicorn
- Pydantic

### LLM Layer

AI Service must depend on an abstract LLM provider/client.

Possible implementations:

- Cloud LLM
- vLLM local serving

The rest of the system must not depend directly on a specific model vendor.

### Database

MVP / development:

- SQLite

Future deployment/scale:

- PostgreSQL

Do not introduce a Vector Database for MVP unless a concrete feature requires it.

---

## 4. System Architecture

The required communication path is:

```text
StudyLens Extension
        ↓ HTTP/REST
ASP.NET Core Backend
        ↓
    ┌───┴───────────┐
    ↓               ↓
Database      FastAPI AI Service
                    ↓
                 LLM Layer
```

### Important boundaries

The Extension MUST NOT:

- call the LLM directly
- contain LLM API keys
- call FastAPI directly unless architecture is explicitly changed

The Extension communicates with **ASP.NET Core Backend**.

The ASP.NET Core Backend is responsible for:

- application/business logic
- persistence
- sessions
- history
- settings
- AI integration orchestration

FastAPI AI Service is responsible for:

- video classification
- transcript processing
- prompt construction
- question generation
- short-answer grading
- explanation generation
- timestamp/reference normalization
- AI output validation

LLM/vLLM is only responsible for model inference.

---

## 5. Repository Style

Use a monorepo for the MVP.

Preferred root layout:

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

Do not create unnecessary microservices.

Do not introduce Kafka, RabbitMQ, Redis, Kubernetes, a Vector Database, event sourcing, CQRS, or other infrastructure unless explicitly required by a real use case.

This is a student-project MVP. Prefer:

1. Works correctly.
2. Matches requirements.
3. Is easy to develop.
4. Is easy to demo.
5. Is easy to test.
6. Then optimize.

---

## 6. Feature-Oriented Development

Do not split work only by technical layers such as:

```text
frontend/
backend/
```

The codebase may contain technical layers, but development tasks should be organized as **vertical features**.

Primary feature modules:

```text
M1 — Video & Activation
M2 — Learning Session
M3 — Quiz Generation
M4 — Answer & Review
M5 — History
M6 — Settings & Reliability
```

### M1 — Video & Activation

Responsibilities:

- YouTube detection
- video metadata
- Auto/Manual mode
- video classification
- ON/OFF override

### M2 — Learning Session

Responsibilities:

- transcript reading
- transcript normalization
- session creation
- actual watched-time tracking
- pause/resume handling
- transcript segmentation

### M3 — Quiz Generation

Responsibilities:

- generate quiz from TranscriptSegment
- Multiple Choice
- Short Answer
- structured AI output
- quiz UI

### M4 — Answer & Review

Responsibilities:

- submit answer
- MCQ deterministic grading
- Short Answer AI grading
- explanation
- timestamp review
- player seek

### M5 — History

Responsibilities:

- persist question/answer/result
- session history
- history by video
- history UI

### M6 — Settings & Reliability

Responsibilities:

- ActivationMode
- QuizInterval
- QuestionType
- Difficulty
- error handling
- retry states
- validation
- security basics

---

## 7. Core Domain Contracts

Shared concepts must use consistent names across Extension, Backend, and AI Service.

### VideoMetadata

```text
videoId
url
title
duration
currentTime
isPlaying
```

### ClassificationResult

```text
classification:
  educational
  non_educational
  unknown

confidence
```

### StudySession

```text
id
userId
videoId
startTime
endTime
interval
activationMode
```

### TranscriptSegment

```text
id
sessionId
startTime
endTime
content
```

`TranscriptSegment` is the main handoff between the learning-flow module and quiz-generation module.

### QuizQuestion

```text
id
segmentId
type
content
options
correctAnswer
explanation
timestamp
```

### AnswerResult

```text
questionId
isCorrect
score
referenceAnswer
explanation
timestamp
```

Do not rename these fields casually.

If an API contract changes, update:

1. API DTO/schema
2. Extension types
3. FastAPI schemas if affected
4. API contract documentation
5. tests

in the same feature change.

---

## 8. API Direction

Initial API surface:

```text
POST /api/videos/classify

POST /api/sessions
GET  /api/sessions/{id}
POST /api/sessions/{id}/segments

POST /api/quizzes/generate
GET  /api/quizzes/{id}
POST /api/quizzes/{id}/answer

GET  /api/history
GET  /api/history/videos/{videoId}

GET  /api/settings
PUT  /api/settings
```

These endpoints are the baseline design and may evolve.

Any change must preserve the product flow and be documented.

---

## 9. Extension Architecture Rules

Recommended structure:

```text
apps/extension/src/
├── content/
│   ├── youtube-detector.ts
│   ├── transcript-reader.ts
│   └── player-controller.ts
│
├── background/
│   └── service-worker.ts
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
├── models/
│
└── sidepanel/
```

### Extension rules

- Keep YouTube DOM/player integration isolated in `content/`.
- Do not mix raw YouTube DOM access into React presentation components.
- Keep HTTP calls behind `api-client.ts` or feature service wrappers.
- React components should not contain AI prompts or database logic.
- Always tolerate Backend/AI errors.
- YouTube playback must continue even when StudyLens services fail.

---

## 10. ASP.NET Core Backend Architecture Rules

Preferred lightweight feature-oriented structure:

```text
services/api/
├── Controllers/
│   ├── VideosController.cs
│   ├── SessionsController.cs
│   ├── QuizzesController.cs
│   ├── HistoryController.cs
│   └── SettingsController.cs
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
└── Program.cs
```

### Backend rules

- Controllers should stay thin.
- Business logic belongs in feature/application services.
- EF Core may be used directly from services where reasonable.
- Do not create a generic Repository layer unless it provides clear value.
- The Backend owns application persistence.
- FastAPI must not write directly into the application database unless explicitly designed later.
- External AI calls must be encapsulated in `AIServiceClient`.

---

## 11. FastAPI AI Service Architecture Rules

Preferred structure:

```text
services/ai-service/app/
├── main.py
│
├── api/
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

### AI rules

All LLM output must be validated against a structured schema before being returned.

Question generation must:

- use the provided transcript segment as the primary source
- avoid adding unsupported knowledge
- preserve timestamp references
- avoid duplicate questions where practical
- produce plausible distractors for MCQ
- return structured output

### Grading rules

Multiple Choice:

- grade using deterministic application logic
- do not call an LLM just to compare selected and correct options

Short Answer:

- LLM may evaluate semantic correctness
- supply:
  - question
  - reference answer
  - relevant transcript
  - learner answer

---

## 12. Transcript Rules

Transcript data is evidence for quiz generation.

Pipeline:

```text
Raw Transcript
    ↓
Cleaning
    ↓
Normalization
    ↓
Timestamp Preservation
    ↓
Segmentation
    ↓
TranscriptSegment
    ↓
AI
```

Never discard timestamps during cleaning.

If transcript is missing or insufficient:

- do not invent content
- do not generate unsupported quizzes
- return a clear error/state

Speech-to-Text is not required for the current MVP unless explicitly added later.

---

## 13. Activation Rules

### Auto mode

```text
classification == educational
AND
confidence >= configured threshold
        ↓
may auto-activate
```

If:

- `non_educational`
- `unknown`
- AI timeout
- low confidence

then do not auto-activate.

The user may still manually turn StudyLens ON.

### Manual mode

Do not auto-activate based on AI classification.

The user controls ON/OFF.

### Override

Explicit user ON/OFF always overrides the current automated decision.

---

## 14. Session Timer Rules

Learning time means **actual watched time**.

Do not count time while video is paused.

Expected example:

```text
Play 3 minutes
Pause 5 minutes
Play 7 minutes

Learning time = 10 minutes
```

When the configured learning interval is reached:

1. identify learned transcript range
2. create TranscriptSegment
3. request quiz generation

---

## 15. Security Rules

Never:

- hardcode secrets
- commit API keys
- put LLM secrets in Extension
- expose stack traces containing sensitive configuration

Use environment variables/server-side configuration.

Provide `.env.example` only with placeholder values.

---

## 16. Error Handling

The following failures must not break YouTube:

- transcript unavailable
- transcript insufficient
- ASP.NET API unavailable
- FastAPI unavailable
- LLM timeout
- invalid LLM JSON
- invalid timestamp
- network interruption

Expected UX:

- clear status
- safe failure
- retry when appropriate
- preserve YouTube player operation

---

## 17. Testing Expectations

Minimum test scopes:

### Extension

- YouTube detection
- video change
- timer
- pause/resume
- segment trigger
- player seek
- Auto/Manual state

### ASP.NET Backend

- session creation
- segment persistence
- quiz orchestration
- answer persistence
- settings
- history
- validation

### FastAPI

- classification schema
- transcript normalization
- question-generation output validation
- grading output validation
- invalid LLM output

### Integration

At least one test/demo path must cover:

```text
Extension
→ ASP.NET Backend
→ FastAPI
→ mock/fake LLM
→ ASP.NET Backend
→ Extension
```

---

## 18. Development Workflow for Codex

Before implementing a feature:

1. Read this `AGENTS.md`.
2. Identify the feature module.
3. Inspect existing contracts and models.
4. Do not redesign unrelated modules.
5. Define/update API contract first.
6. Implement the smallest end-to-end vertical slice.
7. Add tests.
8. Update documentation if the contract changes.

Do not perform large rewrites unless explicitly requested.

Do not silently change technology stack.

Do not add dependencies without a concrete need.

---

## 19. Contract-First Rule

Before Frontend and Backend implementations diverge, define:

- endpoint
- HTTP method
- request DTO
- response DTO
- error response
- sample JSON

Store API contracts in:

```text
docs/api-contracts/
```

The contract is the integration boundary.

Both developers and Codex instances must follow it.

---

## 20. Definition of Done

A feature is not done only because one layer compiles.

A vertical feature is considered done when applicable parts are complete:

```text
Extension UI / integration
+
ASP.NET API
+
FastAPI AI logic if needed
+
Database persistence if needed
+
Validation
+
Happy path
+
Error handling
+
Tests
+
End-to-end demo
```

---

## 21. Current Development Priorities

Recommended implementation order:

```text
M0 Foundation / Walking Skeleton
        ↓
M1 Video & Activation
        ↓
M2 Session + Transcript + Segment
        ↓
M3 Quiz Generation
        ↓
M4 Answer + Grading + Timestamp Review
        ↓
M5 History
        ↓
M6 Settings + Reliability
        ↓
Integration / Stabilization / Evaluation
```

Do not start advanced personalization, flashcards, spaced repetition, advanced dashboard analytics, multi-platform support, or Vector DB work before the MVP flow is stable.

---

## 22. Codex Vibecode Workspace Layout

Codex-facing repo guidance is split by purpose:

```text
AGENTS.md                  repo-level rules loaded automatically
apps/extension/AGENTS.md   Extension-specific rules
services/api/AGENTS.md     Backend-specific rules
services/ai/AGENTS.md      AI-service-specific rules
contracts/AGENTS.md        contract-specific rules

.agents/rules/             shared rule documents and checklists
.agents/playbooks/         repeatable workflows for feature and integration work
.agents/skills/            repo-specific Codex skills
.codex/agents/             project-scoped custom Codex agent profiles
```

Keep root `AGENTS.md` focused on always-loaded repository rules. Put long
workflow details in `.agents/rules/`, `.agents/playbooks/`, or `.agents/skills/`.

Default task routing:

1. Use `$studylens-vertical-feature` for normal Dev 1, Dev 2, or Dev 3 feature work.
2. Use `$studylens-contract-first` before changing API contracts, DTOs, or message schemas.
3. Use `$studylens-integration-captain` only for explicit shared/HOT file integration work.

Project custom agent profiles:

- `.codex/agents/dev1-video-activation.toml`
- `.codex/agents/dev2-session-quiz.toml`
- `.codex/agents/dev3-assessment-history.toml`
- `.codex/agents/integration-captain.toml`

Do not spawn or delegate to multiple agents unless the user explicitly asks for
parallel agent work or the selected skill requires it.
