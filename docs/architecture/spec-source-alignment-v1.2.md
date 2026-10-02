# SRS/SDS traceability matrix - contract 0.5.0

Revision `1.2.2` records the implemented full-transcript and full-video quiz
workflow. Public and AI contracts under `contracts/` remain the integration
source of truth; SRS/SDS describe the product and design rather than replacing
those executable boundaries.

| SRS requirement | SDS design | Contract | Source | Test/evidence | Status |
|---|---|---|---|---|---|
| FR-01/FR-02: explicit persistent ON/OFF and valid YouTube context | Sections 4.2 and 4.5 | `contracts/extension-messages/video-activation.schema.json` | `features/video-activation`, `platform/youtube` | D1-01, D1-02, D1-03, D1-06 | Automated PASS |
| FR-03: create and isolate one session per activation/video | Sections 5 and 9.3 | `public-api/session-quiz.yaml` | `LearningPackageService`, active-tab message state | D1-04, D1-05, D2-03 | Automated PASS |
| FR-04/FR-05: acquire one canonical full transcript and expose processing state | Sections 4.4, 9.1 and 12 | `public-api/session-quiz.yaml` | `transcript-reader.ts`, `youtube-transcript-adapter.ts`, `LearningPackageWorker` | Extension transcript suites, D2-02, D2-07 | Automated PASS |
| FR-06/FR-07: create one full-video quiz with duration-based target count | Sections 6.4 and 9.1 | `ai-api/question-generation.yaml` | `question_generation/service.py`, `LearningPackageWorker` | AI question-generation tests and fake-provider release E2E | Automated PASS |
| FR-08: publish quiz without private answer data | Sections 10 and 11 | `public-api/session-quiz.yaml` | learning-package read model and Side Panel quiz UI | D2-05, D2-06 | Automated PASS |
| FR-09/FR-10: submit the whole attempt atomically and grade short answers through AI | Sections 6.5 and 10 | `public-api/assessment-history.yaml`, `ai-api/grading.yaml` | `AssessmentHistoryService`, `ShortAnswerGradingClient`, `features/grading` | D3-01, D3-02, D3-03, D3-07 | Automated PASS |
| FR-11: review evidence at a valid timestamp | Sections 11.2 and 12 | `public-api/assessment-history.yaml` | `evidence-review.ts`, `youtube-player-adapter.ts` | D3-04, D3-05 | Automated PASS |
| FR-12/FR-13: persist result/history and link it to the correct video | Sections 8 and 10 | `public-api/assessment-history.yaml` | PostgreSQL entities, `AssessmentHistoryService`, history UI | D3-06, D3-08, restart E2E | Automated PASS |
| FR-14: question type and difficulty are session preferences | Sections 4 and 6 | session-quiz preference fields | `learning-preferences.ts`, AI prompt builder | Extension preference and AI prompt tests | Automated PASS |
| FR-15: retry the failed step without duplicate public data | Sections 5, 9 and 12 | retry/error envelopes in contract 0.5.0 | durable `ProcessingJobs`, idempotency and transaction services | D1-07, D2-01...D2-07, D3-01...D3-03 | Automated PASS |
| NFR-03/NFR-10: server-only secrets and isolated release topology | Sections 13 and 16 | Operational configuration only | `docker-compose.release.yml`, Dockerfiles, `release.ps1` | Week 6 Dev 2 evidence | Automated PASS |
| Acceptance 14: Chrome and Edge fault matrix M-01...M-08 | Section 14 | No contract change | packaged Extension and Docker release stack | `week5-fault-matrix.md` | NOT RUN |
| Acceptance 15: three live Gemini smoke cases | Sections 6, 7 and 14 | Existing AI API 0.5.0 | real `GeminiJsonProvider` | Week 6 release evidence | BLOCKED by provider quota/rate limit |

## Runtime flow

```text
ON + valid video -> immediate Backend session
  -> captionTracks -> Timedtext JSON3 -> XML -> guarded DOM preview/fallback
  -> canonical cue hash -> one full transcript upload
  -> Backend validation + PostgreSQL capture + durable job
  -> public-video Gemini transcript fallback only when captions are insufficient
  -> FastAPI/Gemini full-video quiz
  -> whole-attempt grading transaction -> video-linked history -> evidence seek
```

The Extension never contains a Gemini key and never calls Gemini directly.
PostgreSQL is the release source of truth. Legacy SQLite/audio entities remain
only for compatibility and selected isolated tests; they are not the release
runtime. A fake provider is retained solely for explicit deterministic tests
(`release.ps1 smoke -Provider fake`); the normal configured release path uses
the Gemini provider from the root `.env`.

## Remaining release evidence

Automated code, package, migration, restart and fake-provider E2E gates are
complete. Final tag eligibility still requires M-01...M-08 on both Chrome and
Edge plus three successful live Gemini cases. A rate-limited provider response
is recorded as a blocked external gate, not as proof of a successful release.
