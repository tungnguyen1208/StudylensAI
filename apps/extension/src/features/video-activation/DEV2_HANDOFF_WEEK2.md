# Dev 1 to Dev 2 handoff — Week 2 manual activation

## Consumer contract

Dev 2 consumes only the versioned extension-message envelope in
`contracts/extension-messages/video-activation.schema.json`.

- `ACTIVATION_DECIDED` starts a manual study session. Its required payload is
  `decisionId`, `state: active`, `source: manual`, `reasonCode: userEnabled`,
  and a `PreferenceSnapshot`.
- `ACTIVATION_STOPPED` completes the matching session. Its `reasonCode` is
  either `userDisabled` or `videoChanged`.
- The envelope always contains `contractVersion`, `correlationId`, `tabId`,
  `youtubeVideoId`, and `occurredAtUtc`.

`decisionId` remains the business key for Dev 2 idempotency. A manual
activation is valid without a transcript: in that case
`payload.transcriptSnapshot` is absent. Do not infer `available` from an
absent field or create transcript cues locally.

When present, `transcriptSnapshot` is the `TranscriptSnapshotRef` returned by
the VideoActivation API. It belongs to the same `youtubeVideoId` as the
envelope and is safe to snapshot at session start.

## Versioned fixtures

- `contracts/examples/video-activation/manual-on.json`
- `contracts/examples/video-activation/manual-off.json`
- `contracts/examples/video-activation/manual-no-transcript.json`
- `contracts/examples/video-activation/manual-video-changed.json`

The no-transcript fixture intentionally has no `transcriptSnapshot`. The
video-changed fixture stops the session for the old video; a later
`ACTIVATION_DECIDED` for a new video has a different `decisionId`.

## Scope boundary

This handoff covers manual activation only. Auto classification and persisted
preferences are not emitted here. The transcript adapter only observes
already-rendered YouTube transcript DOM and never controls playback.
