# AGENTS.md - StudyLens AI

## Product and runtime

StudyLens AI is a Chrome/Edge Manifest V3 active-learning extension for
YouTube Web. The learner explicitly enables a persistent global gate. The
Extension communicates only with ASP.NET Core Backend; it never calls FastAPI,
an LLM provider, or the database directly.

Contract baseline is **0.4.0**:

```text
ON -> captionTracks -> preferred manual/ASR track
   -> Timedtext JSON3, then XML -> normalized caption cues
   -> Transcript DOM fallback only when direct Timedtext is unavailable
   -> Backend validates and stores cue-only capture -> ACTIVATION_ENABLED
   -> Session -> frozen segment -> Backend -> FastAPI quiz/grading
```

- `extensionEnabled` is stored in `chrome.storage.local`; first install is OFF.
- There is no classification, Auto mode, microphone, STT, tabCapture,
  MediaRecorder, offscreen document, or direct FastAPI call from Extension.
- The only runtime `TranscriptCaptureRef.source` is `youtubeCaption`.
- Direct Timedtext is preferred because it returns YouTube's caption track with
  timestamps. While ON, the DOM fallback may open YouTube's transcript UI and
  observe rendered rows only when direct Timedtext is unavailable. A successful
  direct capture must suppress later DOM uploads for the same acquisition; DOM
  is a fallback, not a second transcript source. A missing/insufficient caption
  keeps global ON but publishes no activation/session/quiz.
- A YouTube SPA A -> B transition publishes one `VIDEO_CONTEXT_CHANGED`,
  cancels stale A work, and enables B only after Backend returns an available
  caption capture. Leaving `/watch` keeps global ON and publishes
  `VIDEO_CONTEXT_UNAVAILABLE`. Only explicit OFF persists OFF.
- Neither normal flow nor any error may pause, seek, or otherwise affect
  YouTube playback.

## Ownership and boundaries

| Owner | Module | Responsibility |
|---|---|---|
| Dev 1 | `video-activation` | persistent toggle, YouTube caption acquisition, SPA transition, PlayerPort, preferences and activation status |
| Dev 2 | `session-quiz` | session, watched-time timer, segments, quiz generation and `QuizPublic` |
| Dev 3 | `assessment-history` | answer, grade, explanation, timestamp review and history |
| Integration Captain | shared wiring | shell, manifest, contracts, migrations, Program.cs and gates |

Published Dev 1 seams are `VIDEO_CONTEXT_CHANGED`,
`VIDEO_CONTEXT_UNAVAILABLE`, `ACTIVATION_ENABLED`, `ACTIVATION_DISABLED`,
`TranscriptCaptureRef`, `PreferenceSnapshot`, `PLAYER_*`, and
`ITranscriptCaptureReader`. Do not import another feature's private state.
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
services/api/src/StudyLens.Api/Features/ # Backend modules and SQLite record
services/ai/app/features/question_generation/, grading/ # FastAPI only
contracts/                       # integration source of truth
```

## Contract and data rules

- Public JSON is camelCase; enums/IDs are strings. Video times are integer
  milliseconds and system time is ISO-8601 UTC.
- Every Extension envelope includes `type`, `contractVersion`,
  `correlationId`, `tabId`, `youtubeVideoId`, `occurredAtUtc`, and `payload`.
- `OPERATION_STATUS_CHANGED` covers `transcriptUpload`, `sessionStart`,
  `segmentCreate`, `quizGenerate`, `answerSubmit`, `historyLoad`. Offer retry
  only for retryable errors; retry uses the same idempotency key.
- Backend validates caption video ID, cue bounds/content, canonical hash and
  idempotency key; it persists only cues and capture metadata. It freezes the
  selected cue segment before calling FastAPI. Existing historical audio tables
  are legacy data and must not be deleted by a feature change.
- FastAPI is never a YouTube transcript source: it receives only a frozen
  Backend segment for quiz generation or answer grading.
- Public quiz data and browser messages must never include answers, rubrics,
  prompts, API keys, raw audio, or provider secrets.
- Settings stay local for the unauthenticated MVP: interval `5|10|15`, type
  `multipleChoice|shortAnswer`, difficulty `easy|medium|hard`; snapshot them
  per activation.

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
