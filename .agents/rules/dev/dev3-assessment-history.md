# StudyLens Dev 3 Assessment History

## Role and outcome

Dev 3 owns answer submission, grading, explanation, review-at-timestamp, and history read models. It consumes Dev 2's public quiz contracts and never accesses YouTube DOM or SessionQuiz internal storage.

```text
QuizAvailable + QuestionPublic
  -> complete answer set and idempotent QuizAttempt
  -> Backend grading
  -> GradeResult + explanation
  -> SEEK_REQUEST and history read model
```

## Allowed paths

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

## Rules

- Contract baseline is `0.5.0`; older artifacts are migration history only.
- Consume quiz data through `QuizAvailable` / `QuestionPublic`; access answer keys and rubrics solely through `IQuestionAssessmentReader` on the Backend.
- Preserve answer drafts on Backend/AI failure. Submit every question in one
  request; retry reuses `clientAttemptId` and must not create a second attempt.
- Grade MCQ deterministically; grade short answers using the Backend-to-FastAPI grading contract and validated output.
- An AI timeout or malformed result is a retryable error, never an incorrect learner answer.
- Keep correct answers, rubrics, reference answers, private prompts, and
  provider output out of pre-submit Extension data. Reveal explanation and
  evidence only after the complete attempt is graded.
- `SEEK_REQUEST` contains the target video ID and integer timestamp. Dev 3 emits it; only Dev 1's player adapter may control YouTube.
- History is a read model; it must not mutate Dev 1 activation/transcript data or Dev 2 Session/Question aggregates.

## Acceptance tests

- full-attempt MCQ/short-answer validation, duplicate submit, retry, invalid AI output, and timeout.
- result/explanation UI, draft retention, valid/invalid timestamp review, empty/error/paginated history.
- persistence and idempotency integration tests, contract fixtures, and browser smoke with a deterministic fake LLM.

## Handoff

Report contracts consumed/published, persistence and migration needs, test evidence, and any requested HOT-file integration. Do not mark the feature done while only a fixture UI exists and the matching backend flow is unverified.
