# v1.2 specification and source alignment

## Authoritative behavior

The repository follows the approved persistent manual-activation decision:
there is no automatic page detector, page-change contract, SPA-navigation
observer, automatic video switch, or video classification.
StudyLens captures one supported YouTube watch page when the learner explicitly
turns ON (or when a restored ON state initializes on that page). To learn from
another page, the learner explicitly turns OFF then ON.

## Implemented source alignment

| Area | Contract/source evidence | Status |
|---|---|---|
| Persistent activation | `extensionEnabled` is first-install OFF and persists in `chrome.storage.local`. | Implemented |
| Activation handoff | `ACTIVATION_ENABLED`/`ACTIVATION_DISABLED`, `TranscriptSnapshotRef` and `PreferenceSnapshot` use envelope `0.2.0`. | Implemented |
| Transcript reliability | Passive DOM reading uploads snapshots; `OPERATION_STATUS_CHANGED` exposes pending, successful and retryable upload failure without affecting YouTube. | Implemented |
| Session → quiz | Dev 2 starts on enable, tracks watched time, creates transcript-backed segments and emits `QUIZ_AVAILABLE`. | Implemented with deterministic fake AI |
| Answer → history | Extension submits answer through ASP.NET; MCQ is Backend-deterministic, short answers use the stateless FastAPI deterministic grader, and results/history persist in SQLite. | Implemented |
| Public data safety | Public quiz/events contain no answer keys, reference answers or grading rubric before answer submission. | Implemented |
| Recoverable failures | Backend returns safe `ErrorEnvelope` values, including `traceId` and `retryable`; Side Panel maps `OPERATION_STATUS_CHANGED` to visible Vietnamese status and exposes Retry only for retryable work. | Implemented |

## Runtime flow

```text
ON / restored ON page
  → passive transcript upload
  → ACTIVATION_ENABLED
  → session + actual watched timer
  → transcript segment
  → deterministic fake question generation
  → QUIZ_AVAILABLE
  → answer API
  → deterministic grade + SQLite history
```

The Extension calls ASP.NET Core only. ASP.NET calls FastAPI only for the
deterministic short-answer grading path. Neither layer exposes a real LLM key.

## Verification required before release

- Extension typecheck, unit tests and build.
- Contract tests for activation, session/quiz, assessment/history and error envelopes.
- ASP.NET module tests with SQLite persistence and idempotent answer replay.
- FastAPI grading schema tests.
- SQLite restart verification for quiz private material and answer/history data.
- Manual Chrome and Edge smoke: upload retry, quiz, answer/history reload,
  Backend/FastAPI outage, and explicit OFF then ON for a new video.
