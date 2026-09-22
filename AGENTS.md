# AGENTS.md - StudyLens AI

## 1. Project purpose

StudyLens AI is a Chrome and Edge Manifest V3 extension for active learning on
YouTube Web. It turns an explicitly enabled YouTube watch page into a learning
flow: transcript evidence, actual watched time, segment, quiz, answer, grade,
timestamp review and persisted history.

```text
YouTube Web
  -> Browser Extension
  -> ASP.NET Core 8 Backend + SQLite
  -> FastAPI AI Service
  -> fake deterministic provider | vLLM | cloud provider
```

The Extension communicates only with the ASP.NET Core Backend. It must never
call FastAPI, an LLM provider or the database directly.

## 2. Persistent Activation v1.2

Contract baseline is **0.2.0**. This is the product behavior to preserve.

1. `extensionEnabled` is one global learner choice stored in
   `chrome.storage.local`. First install defaults to OFF; browser restart
   restores the saved value.
2. There is no Auto mode, educational/non-educational video classifier,
   confidence threshold or classification AI route.
3. When ON on a supported `https://www.youtube.com/watch?v=<11-char-id>` page,
   Dev 1 captures the page, binds the player adapter, reads an already rendered
   transcript, uploads its snapshot and publishes an activation only after the
   snapshot is `available`.
4. When YouTube SPA changes supported video A to B while ON, publish exactly
   one `VIDEO_CONTEXT_CHANGED`, dispose stale work for A, let Dev 2 complete
   session A idempotently, then publish `ACTIVATION_ENABLED` for B only after
   valid transcript evidence exists. Never persist OFF during this transition.
5. When leaving a supported watch page while ON, publish
   `VIDEO_CONTEXT_UNAVAILABLE`, complete only the page flow and keep global ON.
6. Only the learner's explicit OFF persists OFF, stops future work and closes
   active sessions. Backend, AI, transcript and player errors must not alter
   the global setting or interrupt YouTube playback.

The MVP supports YouTube Web only. Do not add Udemy, Coursera, flashcards,
spaced repetition, vector databases, event sourcing, queues, or new platform
services without an explicit user task.

## 3. Module ownership

Work as vertical modules, never as separate frontend, backend and AI teams.

| Owner | Module | Responsibilities |
|---|---|---|
| Dev 1 | `video-activation` | Persistent ON/OFF, supported-page capture, video transition coordinator, PlayerPort/events, passive transcript acquisition, local preferences and activation status |
| Dev 2 | `session-quiz` | StudySession, active timer, playback spans, segments, question generation and `QuizPublic` |
| Dev 3 | `assessment-history` | Answer submission, grading, explanation, timestamp review request and persistent history |
| Integration Captain | Shared wiring | Shell, manifest, root contracts, Program.cs, DbContext/migrations, generated code and release gates |

Published seams only:

```text
Dev 1 -> Dev 2
ExtensionActivationState, VIDEO_CONTEXT_CHANGED,
VIDEO_CONTEXT_UNAVAILABLE, ACTIVATION_ENABLED, ACTIVATION_DISABLED,
TranscriptSnapshotRef, PreferenceSnapshot, PLAYER_* and
ITranscriptSnapshotReader

Dev 2 -> Dev 3
QUIZ_AVAILABLE, QuizPublic, QuestionPublic, QuestionSourceRef,
SessionSnapshot, QuestionForAssessment and IQuestionAssessmentReader

Dev 3 -> Dev 1
SEEK_REQUEST { timestampMs }
```

Do not import another module's private repository, service or state. Only
`apps/extension/src/platform/youtube/**` reads or controls YouTube DOM/player.

## 4. Repository map

```text
apps/extension/src/
  shell/                         # Side Panel, content-script and worker composition (HOT)
  platform/youtube/              # YouTube DOM/player adapters (Dev 1)
  features/video-activation/     # Dev 1 runtime
  features/session-quiz/         # Dev 2 runtime
  features/assessment-history/   # Dev 3 runtime
  shared/contracts/              # public TypeScript contract projections (HOT)
  shared/http/, shared/messaging/
  generated/                     # generated code only

services/api/src/StudyLens.Api/
  Features/VideoActivation/      # transcript snapshot integration seam
  Features/SessionQuiz/
  Features/AssessmentHistory/
  BuildingBlocks/, Infrastructure/Persistence/  # HOT

services/ai/app/
  features/question_generation/  # Dev 2
  features/grading/              # Dev 3
  platform/llm/                  # provider abstraction (HOT)
  main.py                         # router composition (HOT)

contracts/
  public-api/                     # Extension <-> Backend OpenAPI
  ai-api/                         # Backend <-> FastAPI OpenAPI
  extension-messages/             # browser message schemas
  examples/                       # versioned fixtures
```

`contracts/` is the integration source of truth. The current AI service path
is `services/ai/`, never `services/ai-service/`.

## 5. Data and contract rules

- All public JSON uses `camelCase`; enums are strings; opaque IDs are strings.
- Video times are integer milliseconds. System times are ISO-8601 UTC.
- Every Extension envelope has `type`, `contractVersion`, `correlationId`,
  `tabId`, optional `youtubeVideoId`, `occurredAtUtc` and `payload`.
- Current messages include `ACTIVATION_ENABLED`, `ACTIVATION_DISABLED`,
  `VIDEO_CONTEXT_CHANGED`, `VIDEO_CONTEXT_UNAVAILABLE`, `PLAYER_*`,
  `QUIZ_AVAILABLE`, `SEEK_REQUEST` and `OPERATION_STATUS_CHANGED`.
- `OPERATION_STATUS_CHANGED` covers `transcriptUpload`, `sessionStart`,
  `segmentCreate`, `quizGenerate`, `answerSubmit` and `historyLoad`. Show a
  retry action only when the status is retryable.
- Retryable mutations keep their idempotency key: transcript, segment, quiz
  and `clientAttemptId` for an answer. Same key and payload replay safely;
  same key with different payload returns `idempotencyConflict`.
- Public quiz data must never include correct answers, reference answers,
  rubrics, private prompts or provider secrets. These remain Backend/FastAPI
  server-side until a valid post-submit `GradeView`.
- Local learning preferences are stored in `chrome.storage.local` for the
  unauthenticated MVP: interval `5|10|15`, type `multipleChoice|shortAnswer`,
  difficulty `easy|medium|hard`. Snapshot them immutably per activation.

## 6. Layer responsibilities

- **Extension:** Side Panel, storage, YouTube adapter, client-side state and
  typed Backend clients. React components contain neither raw DOM access,
  transport scatter nor business persistence.
- **Backend:** thin endpoints, feature application/domain rules, idempotency,
  persistence, `ErrorEnvelope` and AI orchestration. It is the system of
  record.
- **FastAPI:** thin routers, Pydantic validation and stateless deterministic
  question-generation/short-answer-grading adapters. No classification feature
  and no business database writes.
- **LLM provider:** remains behind `services/ai/app/platform/llm/**`. Never put
  secrets in source, logs, contracts or the Extension bundle.

Standard public error shape:

```json
{
  "code": "string",
  "status": 400,
  "message": "string",
  "traceId": "string",
  "retryable": false
}
```

## 7. HOT files and integration

Only touch the following in an explicit integration task: `AGENTS.md`,
`README.md`, `.agents/**`, `.codex/**`, Extension manifest/Vite config,
`apps/extension/src/shell/**`, `src/shared/**`, `src/generated/**`, solution
and `Program.cs`, backend BuildingBlocks/persistence/migrations, FastAPI
`main.py` and `platform/**`, root contracts, deploy and CI files.

For any such edit, state why it is needed, affected modules/contracts, and
verification commands. Keep shared edits minimal and do not use them to
rewrite another developer's vertical module.

## 8. Workflow

Before code changes:

1. Read this file, the nearest nested `AGENTS.md`, common rules, module-boundary
   rules and the assigned role rule.
2. Read the relevant versioned contracts and fixtures first.
3. For API/DTO/message changes, update contract, example, producer, consumer
   and tests together.
4. Use a fake DOM/player/clock/HTTP/AI port in tests; do not depend on live
   YouTube, wall-clock sleeps or a provider key.
5. Keep generated `dist/` out of source edits; rebuild it only after source
   verification.

## 9. Verification

Run commands from the indicated component directory so they work on every
developer machine.

```cmd
cd /d apps\extension
npm.cmd test
npm.cmd run typecheck
npm.cmd run build

cd /d ..\..
dotnet test .\services\api\StudyLens.sln

cd /d services\ai
py -m pytest app -q
py -c "from app.main import app; print(app.title)"
```

Automated checks do not replace Chrome and Edge smoke for first-install OFF,
restore after restart, ON/OFF, A-to-B transition while ON, leaving a watch page,
transcript unavailable/retry, Backend/FastAPI outage, quiz/answer/history, and
non-interference with YouTube playback.
