# Dev 1 to Dev 2 handoff — Persistent activation, contract 0.3.0

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
  `PreferenceSnapshot`, and an available `TranscriptCaptureRef`. The ref is a
  growing tab-audio STT timeline; Dev 2 reads only available cues through
  `ITranscriptCaptureReader` and freezes the relevant cues into its own segment
  snapshot before quiz generation. `activationId` is the idempotency/business key; there is no
  legacy classifier.
- `ACTIVATION_DISABLED` completes the active session only for explicit user
  OFF with `reasonCode: userDisabled`; it is never emitted for a video change.
- `VIDEO_CONTEXT_UNAVAILABLE` is emitted when ON navigation leaves a supported
  `/watch` page. It carries the prior activation/video identity and
  `reasonCode: unsupportedWatchPage`; Dev 2 completes only that matching
  session and waits for a later `ACTIVATION_ENABLED`. Global ON remains saved.
- `OPERATION_STATUS_CHANGED` reports `audioTranscription` capture/STT state. A
  `failed` + `retryable: true` status means the Side Panel may request a retry;
  it does not pause or otherwise affect YouTube.

Every event has `contractVersion: 0.3.0`, `correlationId`, `tabId`,
`youtubeVideoId`, and `occurredAtUtc`. Dev 2 must not read YouTube DOM or
construct transcript cues itself. When Dev 2 closes for either transition
event, it sends the Backend completion reason `videoContextChanged`; this is
distinct from `activationDisabled`, which is reserved for explicit learner OFF.

## Event order and retry

```text
learner ON
  → transcriptUpload pending
  → first tab-audio STT cue accepted
  → ACTIVATION_ENABLED
  → Dev 2 session/timer/segment/quiz

supported video A → B while ON
  → VIDEO_CONTEXT_CHANGED for A
  → Dev 2 completes A once
  → tab-audio STT for B
  → ACTIVATION_ENABLED for B when transcript is available
  → Dev 2 starts B
```

When ON navigation leaves a supported `/watch` page, the Extension emits one
`VIDEO_CONTEXT_UNAVAILABLE` for the old activation. Dev 2 completes only that
activation once. The global `extensionEnabled` choice remains ON; no
`ACTIVATION_DISABLED` is emitted. A later supported page must upload an
available transcript before its replacement `ACTIVATION_ENABLED`.

If capture/upload/STT fails, the global learner setting remains ON and the current flow is
waiting for transcript evidence. Retrying the same capture/chunk keeps its stable
idempotency key; a successful retry publishes exactly one `ACTIVATION_ENABLED`.
`insufficient` captures are explicit non-retryable evidence states and must never
create an unsupported quiz. A browser restart restores ON but requires the learner
to choose **Bắt đầu thu âm tab** again.

## Fixtures

- `contracts/examples/video-activation/activation-enabled.json`
- `contracts/examples/video-activation/activation-disabled.json`
- `contracts/examples/video-activation/video-context-changed.json`
- `contracts/examples/video-activation/video-context-unavailable.json`
- `contracts/examples/video-activation/transcript-capture-created.json`
- `contracts/examples/video-activation/audio-chunk-progress.json`

## Scope boundary

The coordinator observes only supported YouTube SPA video-ID transitions while
StudyLens is ON. It does not classify videos, persist OFF, call FastAPI/LLM
directly, or let Dev 2 access YouTube DOM.

## Week 4 cloud-provider dependency

The Dev 1 Week 4 activation flow remains provider-agnostic. Dev 1 must keep
using only the ASP.NET Core API and must continue to publish safe
`OPERATION_STATUS_CHANGED` events when transcript upload fails.

The current FastAPI runtime resolves only the deterministic `fake` question
provider. Setting `LLM_PROVIDER=gemini` before the shared provider work is
complete returns `providerNotConfigured`; it must not be treated as a
transcript or activation failure.

Integration Captain with Dev 2 and Dev 3 own the separate provider change:

- add a Gemini implementation behind `app/platform/llm/**`;
- read the local, ignored service environment only (never the Extension);
- pass the configured model identifier through service configuration;
- retain fake/stub providers for automated tests;
- map provider timeout or transport failure to a safe retryable error and
  validate generated output before it reaches the Backend.

Dev 2 must surface question-generation provider failures as `quizGenerate`.
Dev 3 must surface grading provider failures as `answerSubmit`. Neither flow
may pause or seek the YouTube player, and neither may expose a provider key,
prompt, answer key, reference answer, or rubric before a valid grade response.
