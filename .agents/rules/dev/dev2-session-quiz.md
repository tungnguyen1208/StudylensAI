# StudyLens Dev 2 Session Quiz

## Role and outcome

Dev 2 owns the study-session lifecycle and quiz creation. It consumes Dev 1's persistent activation, video-transition, and enabled-page/transcript handoffs; it never accesses YouTube DOM directly.

```text
ExtensionActivationState enabled + VIDEO_CONTEXT_CHANGED + ACTIVATION_ENABLED
  -> immediate StudySession
  -> full transcript validation/fallback job
  -> Backend to FastAPI full-video question generation
  -> QuizAvailable and QuestionPublic for Dev 3
```

`ACTIVATION_DISABLED` completes the current session idempotently. `VIDEO_CONTEXT_CHANGED` and `VIDEO_CONTEXT_UNAVAILABLE` complete only the matching old session idempotently; Dev 2 starts video B as soon as Dev 1 publishes its replacement `ACTIVATION_ENABLED`.

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

- Contract baseline is `0.5.0`; older artifacts are migration history only.
- Start only when `ExtensionActivationState.enabled` is true and an `ACTIVATION_ENABLED` handoff has a valid captured YouTube ID; close only the matching session on `VIDEO_CONTEXT_CHANGED` or `VIDEO_CONTEXT_UNAVAILABLE`.
- Persist immutable preferences with the immediate session. Validate one full
  cue payload from Dev 1; never access YouTube DOM or Dev 1 internals.
- There is no watched-time timer, segment, or 5/10/15-minute threshold.
- Backend owns retryable fallback and quiz orchestration and passes stored full
  transcript evidence to FastAPI. The Extension calls only ASP.NET Core.
- `QuestionPublic` and `QuizAvailable` must not reveal correct answers, reference answers, rubrics, or hidden prompts.
- Publish `QuestionForAssessment` only through the server-side assessment reader port for Dev 3.
- Session/AI failures are recoverable UI state; do not control or interrupt YouTube playback.

## Acceptance tests

- enabled/disabled and video-change session lifecycle; duplicate and out-of-order messages.
- transcript valid/unavailable/insufficient and public-video fallback behavior.
- session/transcript/job/quiz idempotency, invalid AI output, timeout, and public-answer safety.
- contract fixtures plus Extension, Backend, FastAPI, and browser smoke tests relevant to the slice.

## Handoff to Dev 3

Publish versioned `QuizAvailable`, `QuestionPublic`, question source reference, and the server-only `QuestionForAssessment` reader contract. Include fixtures, event ordering, idempotency keys, test evidence, and remaining HOT-file work.
