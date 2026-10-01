# AGENTS.md - StudyLens AI

## Product and runtime

StudyLens AI is a Chrome/Edge Manifest V3 active-learning extension for
YouTube Web. The learner explicitly enables a persistent global gate. The
Extension communicates only with ASP.NET Core Backend; it never calls FastAPI,
an LLM provider, or the database directly.

Contract baseline is **0.5.0**:

```text
ON + supported YouTube video -> ACTIVATION_ENABLED -> Backend creates session
   -> captionTracks -> preferred manual/ASR track -> Timedtext JSON3, then XML
   -> normalized full-video cues -> DOM fallback only when direct Timedtext is unavailable
   -> Backend validates and stores the full transcript
   -> public-video AI fallback only when captions are unavailable/insufficient
   -> Backend job -> FastAPI full-video quiz/grading
```

- `extensionEnabled` is stored in `chrome.storage.local`; first install is OFF.
- There is no classification, Auto mode, microphone, STT, tabCapture,
  MediaRecorder, offscreen document, or direct FastAPI call from Extension.
- Direct Timedtext is preferred because it returns YouTube's caption track with
  timestamps. While ON, the DOM fallback may open YouTube's transcript UI and
  observe rendered rows only when direct Timedtext is unavailable. A successful
  direct capture must suppress later DOM uploads for the same acquisition; DOM
  is a fallback, not a second transcript source. A missing/insufficient caption
  keeps global ON and queues the Backend-owned public-video fallback.
- A YouTube SPA A -> B transition publishes one `VIDEO_CONTEXT_CHANGED`,
  cancels stale A work, closes A idempotently, and immediately enables B.
  Leaving `/watch` keeps global ON and publishes
  `VIDEO_CONTEXT_UNAVAILABLE`. Only explicit OFF persists OFF.
- Neither normal flow nor any error may pause, seek, or otherwise affect
  YouTube playback.

## Ownership and boundaries

| Owner | Module | Responsibility |
|---|---|---|
| Dev 1 | `video-activation` | persistent toggle, YouTube caption acquisition, SPA transition, PlayerPort, preferences and activation status |
| Dev 2 | `session-quiz` | immediate session, full-transcript processing, durable quiz job and `QuizPublic` |
| Dev 3 | `assessment-history` | answer, grade, explanation, timestamp review and history |
| Integration Captain | shared wiring | shell, manifest, contracts, migrations, Program.cs and gates |

Published Dev 1 seams are `VIDEO_CONTEXT_CHANGED`,
`VIDEO_CONTEXT_UNAVAILABLE`, `ACTIVATION_ENABLED`, `ACTIVATION_DISABLED`,
`PreferenceSnapshot`, `PLAYER_*`, and the timestamped transcript handoff. Do
not import another feature's private state.
Only `apps/extension/src/platform/youtube/**` accesses YouTube DOM/player.

## Repository layout

```text
apps/extension/src/
  shell/                         # Side Panel, content script, worker (HOT)
  platform/youtube/              # YouTube caption/DOM/player adapters
  features/video-activation/     # Dev 1
  features/session-quiz/         # Dev 2
  features/assessment-history/   # Dev 3
  shared/contracts/, http/, messaging/ # public projections (HOT)
services/api/src/StudyLens.Api/Features/ # Backend modules and PostgreSQL record
services/ai/app/features/question_generation/, grading/ # FastAPI only
contracts/                       # integration source of truth
```

## Contract and data rules

- Public JSON is camelCase; enums/IDs are strings. Video times are integer
  milliseconds and system time is ISO-8601 UTC.
- Every Extension envelope includes `type`, `contractVersion`,
  `correlationId`, `tabId`, `youtubeVideoId`, `occurredAtUtc`, and `payload`.
- `OPERATION_STATUS_CHANGED` covers `transcriptUpload`, `transcriptGenerate`,
  `sessionStart`, `quizGenerate`, `answerSubmit`, `historyLoad`. Offer retry
  only for retryable errors; retry uses the same idempotency key.
- Backend validates caption video ID, cue bounds/content, canonical hash and
  idempotency key; it persists the full transcript and coordinates durable
  fallback/quiz jobs. Existing historical audio tables are legacy data and must
  not be deleted by a feature change.
- FastAPI receives the Backend-owned full transcript for quiz generation and
  may use a public YouTube URL only as the explicit Gemini transcript fallback.
- Public quiz data and browser messages must never include answers, rubrics,
  prompts, API keys, raw audio, or provider secrets.
- Settings stay local for the unauthenticated MVP: type
  `multipleChoice|shortAnswer` and difficulty `easy|medium|hard`; snapshot them
  per activation. There is no quiz interval or periodic segment setting.

## Change log

Before planning a change, inspect any related `docs/change-log/` record. Add
or update a record after a verified change that affects business rules, public
contracts, data models, integration architecture, core UX flow, or acceptance
criteria. A record may be marked `implemented` only with test evidence. The
log informs future SRS/SDS consolidation; it does not replace SRS/SDS.

## Workflow and verification

Before editing, read this file, the nearest nested `AGENTS.md`, common and
module rules, role rule, and relevant contracts. For schema/API changes update
contract, fixtures, producer, consumer and tests together. Use fake ports in
unit tests; no live YouTube/provider dependency.

Run from component directories:

```cmd
cd /d apps\extension
npm.cmd test
npm.cmd run typecheck
npm.cmd run build

cd /d ..\..
dotnet test .\services\api\StudyLens.sln

cd /d services\ai
py -m pytest app -q
```

Automated gates do not replace Chrome/Edge smoke for ON/OFF, captions
(manual/ASR/missing), A -> B, Backend outage, and YouTube non-interference.
