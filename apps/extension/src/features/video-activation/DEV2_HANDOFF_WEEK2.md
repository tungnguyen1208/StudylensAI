# Dev 1 to Dev 2 handoff — Persistent activation, contract 0.2.0

## Consumer contract

Dev 2 consumes only `contracts/extension-messages/video-activation.schema.json`.

- `ACTIVATION_ENABLED` starts one study session for the YouTube page captured
  when the learner explicitly turned StudyLens ON (or a restored ON state
  initialized that page).
- Its payload is `activationId`, `source: user | storageRestore`, `videoTitle`,
  `PreferenceSnapshot`, and the uploaded `TranscriptSnapshotRef` when one is
  available. `activationId` is the idempotency/business key; there is no
  legacy classifier or automatic page-change field.
- `ACTIVATION_DISABLED` completes the active session with
  `reasonCode: userDisabled`. A page navigation never emits a replacement
  activation or a `videoChanged` stop event.
- `OPERATION_STATUS_CHANGED` reports recoverable transcript upload state. A
  `failed` + `retryable: true` status means the Side Panel may request a retry;
  it does not pause or otherwise affect YouTube.

Every event has `contractVersion: 0.2.0`, `correlationId`, `tabId`,
`youtubeVideoId`, and `occurredAtUtc`. Dev 2 must not read YouTube DOM or
construct transcript cues itself.

## Event order and retry

```text
learner ON
  → transcriptUpload pending
  → transcript snapshot uploaded
  → ACTIVATION_ENABLED
  → Dev 2 session/timer/segment/quiz
```

If upload fails, the global learner setting remains ON and the current flow is
waiting for transcript evidence. Retrying the same captured transcript keeps
its stable idempotency key; a successful retry publishes exactly one
`ACTIVATION_ENABLED`. `unavailable` and `insufficient` snapshots are explicit
non-retryable evidence states and must never create an unsupported quiz.

## Fixtures

- `contracts/examples/video-activation/activation-enabled.json`
- `contracts/examples/video-activation/activation-disabled.json`
- `contracts/examples/video-activation/transcript-unavailable.request.json`
- `contracts/examples/video-activation/transcript-insufficient.request.json`

## Scope boundary

There is no automatic page monitor, SPA navigation observer, automatic page
switch, Auto classification, or direct FastAPI/LLM call from the Extension. To
study another video, the learner explicitly turns StudyLens OFF then ON.
