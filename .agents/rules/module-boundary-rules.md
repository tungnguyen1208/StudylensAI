# Module Boundary Rules

StudyLens is developed as vertical feature modules, not as separate frontend,
backend, and AI teams.

## Dev 1 - Persistent Activation

```text
apps/extension/src/platform/youtube/**
apps/extension/src/features/persistent-activation/**
services/api/src/StudyLens.Api/Features/ActivationSettings/**
services/api/tests/VideoActivation.Tests/**
contracts/public-api/persistent-activation.yaml
contracts/extension-messages/persistent-activation.schema.json
contracts/examples/persistent-activation/**
tests/contract/persistent-activation/**
tests/e2e/persistent-activation/**
```

Dev 1 owns global persistent ON/OFF, one-time current-page capture at enable,
player adapter, transcript acquisition, preferences, and the
`ExtensionActivationState` / `ACTIVATION_ENABLED` handoff. Dev 1 does not own
AI classification or an automatic page detector.

## Dev 2 - Session Quiz

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

Dev 2 owns watched-time tracking, study sessions, transcript segments, quiz
generation orchestration, and public question delivery.

## Dev 3 - Assessment History

```text
apps/extension/src/features/assessment-history/**
services/api/src/StudyLens.Api/Features/AssessmentHistory/**
services/api/tests/AssessmentHistory.Tests/**
services/ai/app/features/grading/**
contracts/public-api/assessment-history.yaml
contracts/ai-api/grading.yaml
contracts/extension-messages/assessment-history.schema.json
contracts/examples/assessment-history/**
tests/contract/assessment-history/**
tests/e2e/assessment-history/**
```

Dev 3 owns answer submit, grading, explanations, timestamp review request, and
history read models.

## Cross-Module Communication

Use published contracts or ports:

- Dev 1 -> Dev 2: `ExtensionActivationState`, `ACTIVATION_ENABLED`, `ACTIVATION_DISABLED`, `TranscriptSnapshotRef`, `PreferenceSnapshot`, player events, `ITranscriptSnapshotReader`.
- Dev 2 -> Dev 3: `QuizAvailable`, `QuestionPublic`, `QuestionSourceRef`, `SessionSnapshot`, `QuestionForAssessment`, `IQuestionAssessmentReader`.
- Dev 3 -> Dev 1: `SEEK_REQUEST` with `{ "timestampMs": number }`.

Do not import another module's internal repository or service directly.
