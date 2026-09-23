# StudyLens Dev 2 Session Quiz

## Role and outcome

Dev 2 owns the study-session lifecycle and quiz creation. It consumes Dev 1's persistent activation, video-transition, and enabled-page/transcript handoffs; it never accesses YouTube DOM directly.

```text
ExtensionActivationState enabled + VIDEO_CONTEXT_CHANGED + ACTIVATION_ENABLED + TranscriptSnapshotRef
  -> StudySession and activeStudyMs
  -> PlaybackSpan and StudySegment
  -> Backend to FastAPI question generation
  -> QuizAvailable and QuestionPublic for Dev 3
```

`ACTIVATION_DISABLED` completes the current session idempotently. `VIDEO_CONTEXT_CHANGED` and `VIDEO_CONTEXT_UNAVAILABLE` complete only the matching old session idempotently; Dev 2 starts video B only when Dev 1 later publishes a valid `ACTIVATION_ENABLED` for B.

## Allowed paths

```text
apps/extension/src/features/session-quiz/**
services/api/src/StudyLens.Api/Features/SessionQuiz/**
services/api/tests/SessionQuiz.Tests/**
services/ai/app/features/question_generation/**
contracts/public-api/session-quiz.yaml
contracts/ai-api/question-generation.yaml
contracts/extension-messages/session-quiz.schema.json
contracts/examples/session-quiz/**
tests/contract/session-quiz/**
tests/e2e/session-quiz/**
```

## Rules

- Contract baseline is `0.3.0`; migrate legacy `0.1.0` artifacts only through an Integration Captain task.
- Start only when `ExtensionActivationState.enabled` is true and an `ACTIVATION_ENABLED` handoff has a valid captured YouTube ID; close only the matching session on `VIDEO_CONTEXT_CHANGED` or `VIDEO_CONTEXT_UNAVAILABLE`.
- Persist an immutable transcript/preference snapshot with the session. Read evidence only through Dev 1's `ITranscriptSnapshotReader`, never through YouTube DOM or Dev 1 internals.
- Count active study time only while enabled and the player is actually playing. Pause, buffering, seek, ended, stale events, and unobserved service-worker downtime do not add time.
- A 5/10/15-minute threshold creates exactly one idempotent segment and one idempotent quiz request.
- Backend owns quiz orchestration and passes only the stored segment evidence to FastAPI. The Extension calls only ASP.NET Core.
- `QuestionPublic` and `QuizAvailable` must not reveal correct answers, reference answers, rubrics, or hidden prompts.
- Publish `QuestionForAssessment` only through the server-side assessment reader port for Dev 3.
- Session/AI failures are recoverable UI state; do not control or interrupt YouTube playback.

## Acceptance tests

- enabled/disabled and video-change session lifecycle; duplicate and out-of-order messages.
- fake-clock play/pause/buffering/seek/resume behavior and non-decreasing active study time.
- transcript valid/unavailable/insufficient behavior; no quiz without supported evidence.
- segment/quiz idempotency, invalid AI output, timeout, and public-answer safety.
- contract fixtures plus Extension, Backend, FastAPI, and browser smoke tests relevant to the slice.

## Handoff to Dev 3

Publish versioned `QuizAvailable`, `QuestionPublic`, question source reference, and the server-only `QuestionForAssessment` reader contract. Include fixtures, event ordering, idempotency keys, test evidence, and remaining HOT-file work.
