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
- Final automated regression: Extension 29 files/103 tests, Backend 86 tests
  (10 Video Activation, 55 Session Quiz, 21 Assessment History), AI Service 62
  tests; typecheck, production build and package verification passed.
- Deterministic release E2E with the **explicit fake provider** passed all three
  shapes: caption MCQ (540000 ms, target/actual 3), caption short answer
  (840000 ms, target/actual 5), and unavailable-caption transcript fallback
  (900000 ms, source `geminiVideo`, target/actual 5). Attempts, scores,
  evidence and video-linked history persisted across PostgreSQL/API restart.
- Live Gemini wiring was exercised with provider `gemini` and a configured
  server-only key. The provider accepted the request but returned
  `providerRateLimited`; therefore no live Gemini case is marked PASS.

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
- M-01...M-08 on Chrome and Edge remain `NOT RUN`.
- The three live Gemini smoke cases remain blocked by provider quota/rate
  availability. Consequently the Week 6 change log is not `implemented` and
  tag `v0.5.0` is not created.
