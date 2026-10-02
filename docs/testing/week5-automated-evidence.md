# Week 5 automated evidence

Recorded on 2026-10-02 for branch `week5/fault-hardening`.

## Commits

| Slice | Commit |
|---|---|
| Dev 1 - OFF gate, multi-tab and video-change failures | `b72b9be` |
| Dev 2 - timeout, idempotency and invalid AI output | `e47f29e` |
| Dev 3 - retry, evidence and history consistency | `9103948` |
| Week 6 Dev 3 - concurrency, restart history and UI recovery | `7c2bb72` |

## Verification commands

| Command | Result |
|---|---|
| `cd apps/extension && npm.cmd test -- --run --reporter=basic` | Exit 0; final regression 29 files/103 tests passed. |
| `cd apps/extension && npm.cmd run typecheck` | Exit 0. |
| `cd apps/extension && npm.cmd run build` | Exit 0; content script and Side Panel production bundles verified. |
| `dotnet test .\services\api\StudyLens.sln --no-restore --verbosity minimal` | Exit 0; Video Activation 10, Session Quiz 55, Assessment History 21 tests passed. |
| `cd services/ai && .\.venv\Scripts\python.exe -m pytest app -q` | Exit 0; 62 tests passed, with one dependency deprecation warning. |

## Dev 1

- D1-01: `persistent-activation.spec.ts` verifies first install is OFF and malformed state returns to safe OFF.
- D1-02: `local-activation-stop.spec.ts` and `youtube-transcript-adapter.spec.ts` verify cancellation and stale late-result suppression.
- D1-03: `global-activation-toggle.spec.ts` verifies OFF is broadcast to every YouTube tab and a hung/failed tab cannot keep ON alive.
- D1-05: `transition-safety.spec.ts`, `youtube-spa-transition-observer.spec.ts`, and the A-to-B-to-C transcript test verify stale work cannot replace the newest video.
- D1-06: the unsupported-route/return observer and Side Panel state tests verify leaving `/watch` preserves the global gate and returning starts a supported flow.
- D1-07: `transcript-service.spec.ts` verifies retry replays the exact prepared cues, canonical hash, and idempotency key.
- D1-04: `active-tab-message.spec.ts` alternates the Side Panel context between two tabs and verifies that inactive/late events cannot replace the active tab while same-tab SPA transitions remain valid.

D1-04 was completed during Week 6 in commit `7ecfd3d`.

## Dev 2

- D2-01: the HTTP client timeout/caller cancellation tests and FastAPI total-deadline test distinguish timeout from caller cancellation.
- D2-02: worker automatic retry limit and failed-quiz manual retry tests keep one job and one final quiz.
- D2-03: concurrent session, transcript, and retry tests cover identical and conflicting database-context races.
- D2-05: worker validation theories reject contract/prompt mismatch, invalid questions/options/timestamps, duplicates, and over-target output before publication.
- D2-06: malformed JSON maps to non-retryable `invalidAiResponse`; transport failure maps to retryable `aiUnavailable`.
- D2-07: `VideoClosedWhileAiIsGenerating_DiscardsLateQuizAndProvisionalTranscript` verifies late AI output leaves no provisional capture or quiz.
- D2-04: `RestartRecovery_RequeuesRunningJobWithoutLosingState_AndPublishesAtMostOneQuiz` persists a `running` job, creates a new database context, requeues the same job without resetting attempt/error state, then publishes exactly one quiz.

The Docker release verification additionally restarted PostgreSQL and Backend,
then re-read the same session from the persisted volume.

## Dev 3

- D3-01: provider failure writes no attempt/answers and the same full-attempt request succeeds after recovery.
- D3-02: identical full-attempt replay returns the stored attempt; reuse with changed answers returns `idempotencyConflict` without extra rows.
- D3-04: negative, equal, reversed ranges and invalid video IDs are rejected before grading and persistence.
- D3-05: Extension tests reject invalid IDs and non-finite, fractional, negative, or unsafe timestamps; the player adapter enforces the video-duration bound.
- D3-07: browser-session state retains drafts, the immutable first payload and `clientAttemptId`; Backend retry persists one completed attempt.
- D3-03: `SubmitAttempt_TwoContextsRace_ConvergesOnOnePersistedAttempt` runs two database contexts through the same full attempt and verifies one attempt, one row per question, and one completed session.
- D3-06: `History_MixedVideosAndAttempts_RecoversAfterRestart_AndCapsWholeGroupsAtOneHundred` verifies mixed videos, batch and legacy data, restart recovery, stable replay, video titles/URLs and the 100-entry boundary.
- D3-08: `history-load-panel.spec.ts` verifies distinct empty, loading, network-error and recovered-history UI states without retaining a stale error or duplicating entries.

## Manual browsers

Chrome and Edge cases M-01 through M-08 remain `NOT RUN`. They require a
loaded unpacked Extension, live browser tabs, service stop/restart controls,
screenshots, sanitized logs, and database before/after evidence. Automated
green status must not be used as a substitute for these browser artifacts.
