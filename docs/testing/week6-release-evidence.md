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
- Current package SHA-256:
  `1aee9625abbe6e5f9b20849fd96b294f8a3b993c6daa2b5c51b20084b09a71a7`.
- D1-04: PASS via `active-tab-message.spec.ts`.

Chrome/Edge screenshots and manual cases remain pending until the release
Docker stack and all three feature slices are complete.

## Dev 2

Not run yet.

## Dev 3

Not run yet.

## Final release

Not run yet.
