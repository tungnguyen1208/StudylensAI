# Week 5 fault matrix

All cases start with status `NOT RUN`. A case may change to `PASS` or `FAIL`
only when the evidence path contains the corresponding test output or browser
artifacts for the recorded commit.

## Automated matrix

| ID | Owner | Mode | Fault/scenario | Expected result | Evidence path | Status |
|---|---|---|---|---|---|---|
| D1-01 | Dev 1 | Automated | StudyLens is OFF when a supported YouTube watch page initializes. | No activation event, session request, caption acquisition, or transcript upload is produced. | [Dev 1 evidence](week5-automated-evidence.md#dev-1) | PASS |
| D1-02 | Dev 1 | Automated | OFF is requested while a Timedtext request or DOM fallback timer is pending. | Pending acquisition is cancelled or made stale; its late result cannot upload a transcript or publish success. | [Dev 1 evidence](week5-automated-evidence.md#dev-1) | PASS |
| D1-03 | Dev 1 | Automated | Two YouTube tabs have live activation flows and the learner turns StudyLens OFF. | Global OFF is persisted once; every live flow stops once; neither tab can upload later results. | [Dev 1 evidence](week5-automated-evidence.md#dev-1) | PASS |
| D1-04 | Dev 1 | Automated | Messages and Side Panel reads alternate between two YouTube tabs. | `tabId` and `youtubeVideoId` remain isolated; an inactive-tab event cannot replace the active tab's context or session. | [Week 6 Dev 1 evidence](week6-release-evidence.md#dev-1) | PASS |
| D1-05 | Dev 1 | Automated | Video A changes to B while A caption work is pending or a transition operation fails. | A work becomes stale, global ON remains unchanged, and B can create exactly one replacement activation and its own retryable transcript flow. | [Dev 1 evidence](week5-automated-evidence.md#dev-1) | PASS |
| D1-06 | Dev 1 | Automated | An ON tab leaves `/watch` and later returns to a supported watch page. | One unavailable event closes the old page flow; ON remains persisted; one new activation starts on return. | [Dev 1 evidence](week5-automated-evidence.md#dev-1) | PASS |
| D1-07 | Dev 1 | Automated | Backend or content-script delivery fails during transcript upload. | UI receives a safe retryable failure, playback is untouched, and retry reuses the prepared cues, hash, and idempotency key. | [Dev 1 evidence](week5-automated-evidence.md#dev-1) | PASS |
| D2-01 | Dev 2 | Automated | Backend-to-AI request exceeds its timeout; separately, the caller cancels the request. | Timeout maps to a safe retryable timeout error; caller cancellation propagates and is not mislabeled as provider timeout. | [Dev 2 evidence](week5-automated-evidence.md#dev-2) | PASS |
| D2-02 | Dev 2 | Automated | A retryable AI timeout repeats until the automatic retry limit. | Persisted attempt count never exceeds the limit; final package exposes the failed retryable step; a manual retry creates one replacement job and one final quiz. | [Dev 2 evidence](week5-automated-evidence.md#dev-2) | PASS |
| D2-03 | Dev 2 | Automated | Identical or conflicting session, transcript, and retry requests race from separate database contexts. | Identical requests converge on one session/capture/job; conflicting payloads return conflict without mutation; retry cannot create duplicate queued work. | [Dev 2 evidence](week5-automated-evidence.md#dev-2) | PASS |
| D2-04 | Dev 2 | Automated | Backend restarts with a processing job persisted as `running`. | Recovery requeues the job and produces at most one capture or quiz without losing its attempt/error state. | [Dev 2 evidence](week5-automated-evidence.md#dev-2) | PASS |
| D2-05 | Dev 2 | Automated | AI returns wrong versions, empty questions, invalid types, timestamps, options, answer keys, or duplicate questions. | No public quiz is published; the failed step has a safe non-retryable invalid-output error; private answer data is not exposed. | [Dev 2 evidence](week5-automated-evidence.md#dev-2) | PASS |
| D2-06 | Dev 2 | Automated | AI returns a malformed/non-JSON error body or is unreachable. | Malformed output maps to non-retryable `invalidAiResponse`; an unreachable provider maps to retryable `aiUnavailable`; neither exposes provider internals or throws an unhandled exception. | [Dev 2 evidence](week5-automated-evidence.md#dev-2) | PASS |
| D2-07 | Dev 2 | Automated | Video context closes while transcript fallback or quiz generation is in flight. | Late results are discarded, pending jobs are cancelled, and no provisional capture or quiz survives for the closed incomplete session. | [Dev 2 evidence](week5-automated-evidence.md#dev-2) | PASS |
| D3-01 | Dev 3 | Automated | Short-answer grading fails with timeout, rate limit, or invalid AI grade, then succeeds on retry. | Failed grading writes no attempt/history and leaves the session retryable; the same `clientAttemptId` succeeds once after recovery. | [Dev 3 evidence](week5-automated-evidence.md#dev-3) | PASS |
| D3-02 | Dev 3 | Automated | A full-attempt `clientAttemptId` is replayed with identical answers and then reused with different answers. | Identical replay returns the original attempt; conflicting replay returns conflict and leaves the original history unchanged. | [Dev 3 evidence](week5-automated-evidence.md#dev-3) | PASS |
| D3-03 | Dev 3 | Automated | Two database contexts concurrently submit the same or conflicting complete attempt. | Exactly one attempt with one row per question is stored; a conflicting loser cannot create partial or duplicate rows. | [Dev 3 evidence](week5-automated-evidence.md#dev-3) | PASS |
| D3-04 | Dev 3 | Automated | A question carries a negative, reversed, or otherwise invalid evidence timestamp/video ID. | Attempt is rejected before grading or persistence, and history never emits a contract-invalid review target. | [Dev 3 evidence](week5-automated-evidence.md#dev-3) | PASS |
| D3-05 | Dev 3 | Automated | Evidence review receives an invalid ID or non-finite, fractional, negative, or out-of-range timestamp. | No unsafe URL or player command is produced; a valid target produces only the canonical YouTube URL or bounded same-video seek. | [Dev 3 evidence](week5-automated-evidence.md#dev-3) | PASS |
| D3-06 | Dev 3 | Automated | History is read after restart with multiple videos, sessions, batch attempts, legacy rows, failed retries, and more than 100 entries. | Filtering, descending order, top-100 limit, grouping, scores, and titles remain consistent; failed and duplicate attempts are absent. | [Dev 3 evidence](week5-automated-evidence.md#dev-3) | PASS |
| D3-07 | Dev 3 | Automated | A complete quiz submit fails and the learner retries. | Every answer draft is retained, the same `clientAttemptId` and immutable payload are reused, and one successful result disables further duplicate submission. | [Dev 3 evidence](week5-automated-evidence.md#dev-3) | PASS |
| D3-08 | Dev 3 | Automated | History API returns empty data, network failure, then recovery for a video-specific request. | Empty/error/recovered states are distinct; video IDs are safely encoded; recovery does not duplicate history entries. | [Dev 3 evidence](week5-automated-evidence.md#dev-3) | PASS |

## Chrome and Edge manual matrix

Each row must be executed separately in Chrome and Edge.

| ID | Mode | Fault/scenario | Expected result | Chrome evidence | Chrome status | Edge evidence | Edge status |
|---|---|---|---|---|---|---|---|
| M-01 | Manual | First install or persisted OFF; open a captioned YouTube video. | No session/transcript network writes occur and YouTube playback remains normal. | `artifacts/week5/chrome/M-01/` | NOT RUN | `artifacts/week5/edge/M-01/` | NOT RUN |
| M-02 | Manual | Turn ON at video time `0:00` with captions available. | Full transcript is acquired without playing to the end; exactly one capture, job, and quiz are produced. | `artifacts/week5/chrome/M-02/` | NOT RUN | `artifacts/week5/edge/M-02/` | NOT RUN |
| M-03 | Manual | Open videos A and B in two tabs, switch tabs, then turn OFF. | Side Panel follows the active tab without data crossover; OFF stops both flows and no late upload occurs. | `artifacts/week5/chrome/M-03/` | NOT RUN | `artifacts/week5/edge/M-03/` | NOT RUN |
| M-04 | Manual | Navigate A to B during caption acquisition and during quiz generation. | A closes/cancels once, stale A data never appears in B, global ON remains, and B becomes the only current flow. | `artifacts/week5/chrome/M-04/` | NOT RUN | `artifacts/week5/edge/M-04/` | NOT RUN |
| M-05 | Manual | Leave `/watch`, then return to another supported video while ON. | ON remains visible and persisted; the old session closes once; the new video starts one session. | `artifacts/week5/chrome/M-05/` | NOT RUN | `artifacts/week5/edge/M-05/` | NOT RUN |
| M-06 | Manual | Stop Backend during transcript upload, restore it, and retry. | Playback is unaffected; UI shows a retryable failure; recovery creates one idempotent capture/job. | `artifacts/week5/chrome/M-06/` | NOT RUN | `artifacts/week5/edge/M-06/` | NOT RUN |
| M-07 | Manual | Stop AI Service during quiz generation or grading, restore it, and retry. | No partial quiz/history is stored; answer drafts remain; recovery creates one attempt/history result. | `artifacts/week5/chrome/M-07/` | NOT RUN | `artifacts/week5/edge/M-07/` | NOT RUN |
| M-08 | Manual | Restart browser and services, open history, and review same-video, cross-video, and invalid evidence targets. | Persisted history is unchanged; valid same-video seek and canonical cross-video URL work; invalid target causes no seek. | `artifacts/week5/chrome/M-08/` | NOT RUN | `artifacts/week5/edge/M-08/` | NOT RUN |

## Evidence contents

| Evidence path | Required contents | Status |
|---|---|---|
| `docs/testing/week5-automated-evidence.md` | Test commands, commit SHAs, exit results, and direct test-to-case mapping. | PASS |
| `artifacts/week5/<browser>/<case-id>/before.png` | Side Panel and relevant YouTube state before the fault/action. | NOT RUN |
| `artifacts/week5/<browser>/<case-id>/after.png` | Final Side Panel and YouTube state after recovery or rejection. | NOT RUN |
| `artifacts/week5/<browser>/<case-id>/browser-console.txt` | Browser name/version, OS, commit SHA, extension version, case steps, and sanitized console output. | NOT RUN |
| `artifacts/week5/<browser>/<case-id>/backend.log` | Sanitized Backend log covering the case correlation/session identifiers. | NOT RUN |
| `artifacts/week5/<browser>/<case-id>/ai.log` | Sanitized AI Service log when the case crosses the AI boundary. | NOT RUN |
| `artifacts/week5/<browser>/<case-id>/db.txt` | Sanitized row counts/identifiers for sessions, jobs, captures, quizzes, attempts, and answers before and after the case. | NOT RUN |
