# Dev 1 to Dev 2 handoff — Persistent activation, contract 0.2.0

## Consumer contract

Dev 2 consumes only `contracts/extension-messages/video-activation.schema.json`.

- `VIDEO_CONTEXT_CHANGED` is emitted first for a supported YouTube SPA A-to-B
  transition while the learner remains ON. The envelope `youtubeVideoId` is B;
  its payload has `transitionId`, `previousActivationId`,
  `previousYoutubeVideoId`, and B's `videoTitle`. Dev 2 completes only the
  matching A session and must tolerate duplicate or stale transitions.
- `ACTIVATION_ENABLED` starts one study session for the page captured when the
  learner turned StudyLens ON, restored an ON state, or finished capturing B.
- Its payload is `activationId`, `source: user | storageRestore`, `videoTitle`,
  `PreferenceSnapshot`, and the uploaded `TranscriptSnapshotRef` when one is
  available. `activationId` is the idempotency/business key; there is no
  legacy classifier.
- `ACTIVATION_DISABLED` completes the active session only for explicit user
  OFF with `reasonCode: userDisabled`; it is never emitted for a video change.
- `VIDEO_CONTEXT_UNAVAILABLE` is emitted when ON navigation leaves a supported
  `/watch` page. It carries the prior activation/video identity and
  `reasonCode: unsupportedWatchPage`; Dev 2 completes only that matching
  session and waits for a later `ACTIVATION_ENABLED`. Global ON remains saved.
- `OPERATION_STATUS_CHANGED` reports recoverable transcript upload state. A
  `failed` + `retryable: true` status means the Side Panel may request a retry;
  it does not pause or otherwise affect YouTube.

Every event has `contractVersion: 0.2.0`, `correlationId`, `tabId`,
`youtubeVideoId`, and `occurredAtUtc`. Dev 2 must not read YouTube DOM or
construct transcript cues itself. When Dev 2 closes for either transition
event, it sends the Backend completion reason `videoContextChanged`; this is
distinct from `activationDisabled`, which is reserved for explicit learner OFF.

## Event order and retry

```text
learner ON
  → transcriptUpload pending
  → transcript snapshot uploaded
  → ACTIVATION_ENABLED
  → Dev 2 session/timer/segment/quiz

supported video A → B while ON
  → VIDEO_CONTEXT_CHANGED for A
  → Dev 2 completes A once
  → transcriptUpload for B
  → ACTIVATION_ENABLED for B when transcript is available
  → Dev 2 starts B
```

If upload fails, the global learner setting remains ON and the current flow is
waiting for transcript evidence. Retrying the same captured transcript keeps
its stable idempotency key; a successful retry publishes exactly one
`ACTIVATION_ENABLED`. `unavailable` and `insufficient` snapshots are explicit
non-retryable evidence states and must never create an unsupported quiz.

## Fixtures

- `contracts/examples/video-activation/activation-enabled.json`
- `contracts/examples/video-activation/activation-disabled.json`
- `contracts/examples/video-activation/video-context-changed.json`
- `contracts/examples/video-activation/video-context-unavailable.json`
- `contracts/examples/video-activation/transcript-unavailable.request.json`
- `contracts/examples/video-activation/transcript-insufficient.request.json`

## Scope boundary

The coordinator observes only supported YouTube SPA video-ID transitions while
StudyLens is ON. It does not classify videos, persist OFF, call FastAPI/LLM
directly, or let Dev 2 access YouTube DOM.
