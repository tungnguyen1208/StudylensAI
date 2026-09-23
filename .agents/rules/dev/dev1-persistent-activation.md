# StudyLens Dev 1 Persistent Activation

## Role and outcome

Dev 1 owns the learner's global persistent ON/OFF choice and all YouTube Web
integration. The module must deliver a safe public handoff for Dev 2 without
classifying a video's subject matter.

```text
chrome.storage.local extensionEnabled
  -> ExtensionActivationState
  -> supported YouTube page capture at ON and on supported video transitions + player events
  -> tab-audio STT timeline + preferences
  -> Dev 2 SessionQuiz
```

The first installation defaults to OFF. Later browser launches restore the
saved state. While ON, a controlled YouTube SPA transition coordinator detects
supported video-ID changes, tells Dev 2 to close the old session, and captures
the replacement page. Leaving a watch page must not persist OFF.

## Allowed paths

```text
apps/extension/src/platform/youtube/**
apps/extension/src/platform/audio/**
apps/extension/src/features/video-activation/**
services/api/tests/VideoActivation.Tests/**
contracts/public-api/video-activation.yaml
contracts/extension-messages/video-activation.schema.json
contracts/examples/video-activation/**
tests/contract/video-activation/**
tests/e2e/video-activation/**
```

`video-activation/**` is the current Dev 1 runtime path. Do not create a
parallel implementation or mix contract versions.

## Owns

- `ExtensionActivationState { enabled, source: user | storageRestore, persistedAtUtc }`.
- `VIDEO_CONTEXT_CHANGED`, `ACTIVATION_ENABLED`, and `ACTIVATION_DISABLED`; the transition envelope identifies the prior flow and the enabled envelope carries the captured YouTube ID.
- `PlayerPort` and normalized player events; only `platform/youtube/**` reads or controls YouTube DOM.
- Learner-approved tab-audio capture in 30-second WebM/Opus chunks, cue normalization,
  timestamp preservation, and `TranscriptCaptureRef` publication. Raw audio is never persisted.
- `PreferenceSnapshot` for interval (5/10/15), question type, and difficulty.
- Side Panel activation, video-context, transcript, and recoverable-error display.

## Does not own

- Auto mode, educational/non-educational classification, confidence thresholds, or a classification AI route.
- Session lifecycle, active-study timer, playback spans, segments, quiz generation, grading, seek UX, or history.
- Direct FastAPI/LLM/database access from Extension.

## Required behavior

1. Store only an explicit learner toggle to `chrome.storage.local`.
2. Restore the saved value at startup and publish `source: storageRestore`.
3. When ON on a supported watch page, require a learner gesture for `tabCapture`, capture
   tab audio through the offscreen document, and publish the enabled event only after the
   first valid STT cue is available. A restored ON state asks the learner to click
   the **StudyLens toolbar icon**; it never starts tab capture silently after browser restart.
4. When a supported YouTube SPA video ID changes while ON, dispose stale adapters/tasks, publish exactly one `VIDEO_CONTEXT_CHANGED`, and capture the replacement page. Only a valid replacement transcript may publish its `ACTIVATION_ENABLED`.
   When navigation leaves a supported watch page, publish
   `VIDEO_CONTEXT_UNAVAILABLE`, stop only the page flow, and retain global ON.
5. On user OFF, persist OFF and publish the stop state. Do not pause, seek, or otherwise disrupt YouTube on errors.
6. Transcript `unavailable` or `insufficient` is an explicit state. Never invent cues or enable unsupported quiz generation.

## Contract and data rules

- Contract baseline: `0.3.0`; camelCase; string enums; opaque IDs; integer video milliseconds; ISO-8601 UTC system time.
- Every Extension message uses the common envelope: `type`, `contractVersion`, `correlationId`, `tabId`, optional `youtubeVideoId`, `occurredAtUtc`, `payload`.
- Emit idempotent state/context messages and tolerate stale/out-of-order browser events.
- Extension never receives or stores LLM keys, correct answers, hidden prompts, or grading rubrics.
- Backend is the only system of record. FastAPI may receive only an in-flight audio
  chunk from Backend for STT and never persists the audio.

## Acceptance tests

- First install is OFF; a saved ON/OFF is restored after browser restart.
- OFF remains OFF until explicit user ON.
- A supported `/watch?v=<11-char-id>` page can be captured only on ON; unsupported URLs fail safely.
- Video A to B while ON closes the active flow once through `VIDEO_CONTEXT_CHANGED`; B starts only after valid transcript evidence.
- Leaving `/watch` while ON closes the prior flow through
  `VIDEO_CONTEXT_UNAVAILABLE`; a later supported page may start a replacement flow without another learner ON action.
- Player events use milliseconds and do not duplicate after mount/remount.
- Tab-audio STT preserves valid cue timestamps; unavailable/insufficient states never produce an available reference.
- Backend/AI/network failure never pauses or breaks YouTube.
- Chrome and Edge smoke checks validate reload, restored state, A-to-B transition while ON, transcript present/absent, and explicit OFF.

## Handoff to Dev 2

Publish fixture-backed `ExtensionActivationState`, `VIDEO_CONTEXT_CHANGED`, `VIDEO_CONTEXT_UNAVAILABLE`, `ACTIVATION_ENABLED`,
`ACTIVATION_DISABLED`, `TranscriptCaptureRef`, `PreferenceSnapshot`, player-event envelopes, and
`ITranscriptCaptureReader` / `TranscriptCaptureForSession`. Document the
contract version, event order, idempotency behavior, test evidence, and any
required HOT-file integration separately.
