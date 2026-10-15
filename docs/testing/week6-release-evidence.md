# Week 6 release evidence

Evidence is added only after the corresponding command or browser case has
completed. Raw logs, database dumps and credentials remain under ignored
`artifacts/`; this file records sanitized results and committed evidence paths.

## Dev 1

- Commit: `7ecfd3d` (`feat(extension): package release and isolate active tabs`).
- `npm.cmd test -- --run --reporter=basic`: PASS, 28 files and 101 tests.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run build`: PASS; content script, service worker and Side Panel
  production bundles verified.
- `release.ps1 verify`: PASS.
- Deterministic rebuild check: PASS; two consecutive packages from the same
  commit produced the same SHA-256.
- Release artifact: `StudyLens-AI-extension-0.5.0.zip`.
- Stable Extension ID: `pamlknppggagbabbonlighcagfjemdcp`.
- `SHA256SUMS.txt` is regenerated from the final source commit and verified by
  `release.ps1 verify`; the release manifest records that source commit.
- D1-04: PASS via `active-tab-message.spec.ts`.

Chrome/Edge screenshots and manual cases remain pending. Automated package
verification does not replace the two-browser evidence requirement.

## Dev 2

- Backend: PASS, 84 tests (Video Activation 10, Session Quiz 55,
  Assessment History 19).
- AI Service: PASS, 62 tests.
- D2-04 restart recovery: PASS; the same persisted job was requeued without
  resetting attempt/error state and produced exactly one quiz.
- Fresh migration and repeat/idempotent migration: PASS.
- Previous-to-latest migration: PASS; the last history lookup index was absent
  at `20261001090000_AddPostgresQuizMetadata` and present after latest.
- PostgreSQL/Backend restart persistence: PASS; the same session was returned
  after readiness recovered.
- Backup/restore: PASS; all 13 public tables were restored into an isolated
  verification database.
- Release stack: PostgreSQL, AI and API healthy; migration exited successfully
  before API startup; only `127.0.0.1:5000` was published.
- Container users: Backend `app`, AI `studylens`.
- CORS: configured Extension origin allowed; unconfigured Extension origin not
  allowed; AI Service exposes no browser CORS middleware.
- Sanitized log scan found no database password or Gemini key.

## Dev 3

- Commit: `7c2bb72` (`test(history): complete week6 concurrency and recovery cases`).
- D3-03: PASS; two database contexts converge on one persisted full attempt
  with one answer row per question.
- D3-06: PASS; mixed video/batch/legacy history survives a new database
  context, remains stable, carries the correct video title/URL, and caps whole
  groups at 100 entries.
- D3-08: PASS; the Side Panel renders distinct empty, loading, network-error
  and recovered-history states.
- Final automated regression: Extension 30 files/106 tests, Backend 97 tests
  (10 Video Activation, 66 Session Quiz, 21 Assessment History), AI Service 72
  tests; typecheck, production build and package verification passed.
- Deterministic release E2E with the **explicit fake provider** passed all three
  shapes: caption MCQ (540000 ms, target/actual 3), caption short answer
  (840000 ms, target/actual 5), and unavailable-caption transcript fallback
  (900000 ms, source `geminiVideo`, target/actual 5). Attempts, scores,
  evidence and video-linked history persisted across PostgreSQL/API restart.
- Live Gemini question generation passed for all three release shapes:
  caption MCQ (591000 ms, 157 cues, target/actual 3), caption short answer
  (1235000 ms, 678 cues, target/actual 5), and unavailable-caption fallback
  (577000 ms, 137 bounded cues, source `geminiVideo`, target/actual 3).
- Topic review found all eleven questions addressed central lesson concepts;
  no question selected a greeting, advertisement, isolated name, year or side
  experiment. The current prompt therefore remained `0.5.1` and no additional
  ranking/provider stage was introduced.
- The fallback session stored one capture, one quiz and the two expected jobs.
  Maximum cue end was 577000 ms and maximum quiz evidence end was 543785 ms.
  Transcript and quiz jobs completed in about 37.0 s and 4.5 s. Attempts and
  video-linked history were exercised for all three live quiz shapes.

## Final release

- Release workflow/tooling commit: `77b4dca`.
- SRS and SDS were updated in place to revision `1.2.2`, rendered through Word
  and visually checked page by page (17 SRS pages and 29 SDS pages).
- The normal release path now resolves `LLM_PROVIDER=gemini` from the root
  `.env`. Fake mode is test-only and must be explicitly requested with
  `release.ps1 smoke -Provider fake`.
- The configured Docker stack was restarted after that correction; AI health
  reported provider `gemini` with a key present. Existing fake-provider rows
  remain historical test data and are not evidence of a live Gemini run.
- Stage-based processing status replaced fixed percentages and now shows the
  elapsed wait. Backend logs queue, provider, persistence and total durations
  using only session/job identifiers and safe result codes.
- A PostgreSQL smoke exposed and verified the incomplete-session completion
  fix: closing a session without a transcript now returns `closed` instead of
  failing because of an incompatible user-managed transaction.
- M-01...M-08 on Chrome and Edge remain `NOT RUN`. Consequently the Week 6
  release record remains `accepted` and tag `v0.5.0` is not created.
