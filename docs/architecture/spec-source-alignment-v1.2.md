# v1.2 specification and source alignment

## Authoritative behavior

`extensionEnabled` is the learner's global persisted choice: first install is
OFF, and browser restart restores the saved setting. The MVP does not classify
videos. While ON, Dev 1 observes supported YouTube SPA video-ID changes only to
coordinate the learning flow; it must never silently persist OFF. A transition
A to B emits `VIDEO_CONTEXT_CHANGED`, closes only session A through the Dev 2
seam, then permits `ACTIVATION_ENABLED` for B only after B has an available
tab-audio STT capture.

If ON navigation leaves a supported watch page, Dev 1 publishes
`VIDEO_CONTEXT_UNAVAILABLE` with the prior activation identity. Dev 2 closes
only that prior session; global ON waits for the next supported capture.

## Implemented source alignment

| Area | Contract/source evidence | Status |
|---|---|---|
| Persistent activation | `extensionEnabled` is first-install OFF and persists in `chrome.storage.local`. | Implemented |
| No classification | FastAPI registers question generation, short-answer grading and tab-audio transcription; no classification contract or route remains. | Implemented |
| Video transition seam | `VIDEO_CONTEXT_CHANGED` identifies the prior activation and replacement supported YouTube ID; `VIDEO_CONTEXT_UNAVAILABLE` closes only the old flow when ON navigation leaves `/watch`. | Dev 1 producer and Dev 2 matching-session consumer implemented; Backend records `videoContextChanged` |
| Activation handoff | `ACTIVATION_ENABLED`/`ACTIVATION_DISABLED`, `TranscriptCaptureRef` and `PreferenceSnapshot` use envelope `0.3.0`. | Implemented; replacement enable is produced only after the first valid STT cue |
| Learning preferences | Interval, question type and difficulty persist in `chrome.storage.local` and are immutable per activation. | Implemented |
| Tab-audio transcript | Learner-approved tab capture records 30-second WebM/Opus chunks through an offscreen document; Backend persists only STT cues and capture metadata. `audioTranscription` status exposes permission, capture, STT and retryable failure without affecting YouTube. | Implemented; Chrome/Edge smoke remains required |
| Session → quiz | Dev 2 starts on enable, tracks watched time, creates transcript-backed segments and emits `QUIZ_AVAILABLE`. | Implemented with deterministic fake AI |
| Answer → history | Extension submits answer through ASP.NET; MCQ is Backend-deterministic, short answers use the stateless FastAPI deterministic grader, and results/history persist in SQLite. | Implemented |
| Public data safety | Public quiz/events contain no answer keys, reference answers or grading rubric before answer submission. | Implemented |
| Recoverable failures | Backend returns safe `ErrorEnvelope` values, including `traceId` and `retryable`; Side Panel maps `OPERATION_STATUS_CHANGED` to visible Vietnamese status and exposes Retry only for retryable work. | Implemented |

## Runtime flow

```text
ON / restored ON page
  → learner-approved tab audio capture and STT timeline
  → ACTIVATION_ENABLED
  → session + actual watched timer
  → supported YouTube SPA video B
  → VIDEO_CONTEXT_CHANGED (close A only)
  → B transcript upload
  → ACTIVATION_ENABLED for B
  → transcript segment
  → deterministic fake question generation
  → QUIZ_AVAILABLE
  → answer API
  → deterministic grade + SQLite history
```

The Extension calls ASP.NET Core only. ASP.NET calls FastAPI for question generation,
grading and the in-flight tab-audio STT path. Neither layer exposes a provider key;
raw audio is discarded after each STT request.

## Verification required before release

- Extension typecheck, unit tests and build.
- Contract tests for activation, session/quiz, assessment/history and error envelopes.
- ASP.NET module tests with SQLite persistence and idempotent answer replay.
- FastAPI grading schema tests.
- SQLite restart verification for quiz private material and answer/history data.
- Manual Chrome and Edge smoke: A-to-B transition while ON, upload retry, quiz,
  answer/history reload, Backend/FastAPI outage, browser restore and explicit OFF.
