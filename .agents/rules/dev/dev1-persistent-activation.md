# StudyLens Dev 1 Persistent Activation

## Role and outcome

Dev 1 owns the learner's global persistent ON/OFF choice and all YouTube Web
integration. The module must deliver a safe public handoff for Dev 2 without
classifying a video's subject matter.

```text
chrome.storage.local extensionEnabled
  -> ExtensionActivationState
  -> one supported YouTube page capture at ON + player events
  -> transcript snapshot + preferences
  -> Dev 2 SessionQuiz
```

The first installation defaults to OFF. Later browser launches restore the
saved state. Automatic page detection, SPA-navigation observation, and automatic
session switching are out of scope. A learner starts a flow for a new video by
explicitly turning StudyLens OFF and then ON. Leaving a watch page must not
persist OFF.

## Allowed paths

```text
apps/extension/src/platform/youtube/**
apps/extension/src/features/persistent-activation/**
services/api/src/StudyLens.Api/Features/ActivationSettings/**
services/api/tests/VideoActivation.Tests/**
contracts/public-api/persistent-activation.yaml
contracts/extension-messages/persistent-activation.schema.json
contracts/examples/persistent-activation/**
tests/contract/persistent-activation/**
tests/e2e/persistent-activation/**
```

The pre-migration `video-activation/**` paths and `0.1.0` contracts may only
be changed in the explicit Integration Captain migration task. Do not create a
parallel implementation that emits both contract versions.

## Owns

- `ExtensionActivationState { enabled, source: user | storageRestore, persistedAtUtc }`.
- `ACTIVATION_ENABLED` and `ACTIVATION_DISABLED`; the enabled event envelope carries the YouTube ID captured once when a flow starts.
- `PlayerPort` and normalized player events; only `platform/youtube/**` reads or controls YouTube DOM.
- Passive transcript acquisition, cue normalization, timestamp preservation, and `TranscriptSnapshotRef` publication.
- `PreferenceSnapshot` for interval (5/10/15), question type, and difficulty.
- Side Panel activation, video-context, transcript, and recoverable-error display.

## Does not own

- Auto mode, educational/non-educational classification, confidence thresholds, or a classification AI route.
- Session lifecycle, active-study timer, playback spans, segments, quiz generation, grading, seek UX, or history.
- Direct FastAPI/LLM/database access from Extension.

## Required behavior

1. Store only an explicit learner toggle to `chrome.storage.local`.
2. Restore the saved value at startup and publish `source: storageRestore`.
3. When ON on a supported watch page, capture the page once and publish the current activation state, enabled event, transcript reference when available, preferences, and player events.
4. Do not observe video changes or publish a context-change event. A bound player that no longer matches the captured page must ignore its event; the learner explicitly uses OFF then ON for the new page.
5. On user OFF, persist OFF and publish the stop state. Do not pause, seek, or otherwise disrupt YouTube on errors.
6. Transcript `unavailable` or `insufficient` is an explicit state. Never invent cues or enable unsupported quiz generation.

## Contract and data rules

- Contract baseline: `0.2.0`; camelCase; string enums; opaque IDs; integer video milliseconds; ISO-8601 UTC system time.
- Every Extension message uses the common envelope: `type`, `contractVersion`, `correlationId`, `tabId`, optional `youtubeVideoId`, `occurredAtUtc`, `payload`.
- Emit idempotent state/context messages and tolerate stale/out-of-order browser events.
- Extension never receives or stores LLM keys, correct answers, hidden prompts, or grading rubrics.
- Backend is the only system of record; FastAPI has no Dev 1 feature in this architecture.

## Acceptance tests

- First install is OFF; a saved ON/OFF is restored after browser restart.
- OFF remains OFF until explicit user ON.
- A supported `/watch?v=<11-char-id>` page can be captured only on ON; unsupported URLs fail safely.
- Video A to B does not switch the active flow. OFF then ON captures B for Dev 2.
- Player events use milliseconds and do not duplicate after mount/remount.
- Transcript preserves valid cue timestamps; unavailable/insufficient states never produce an available reference.
- Backend/AI/network failure never pauses or breaks YouTube.
- Chrome and Edge smoke checks validate reload, restored state, explicit OFF then ON for a new video, transcript present/absent, and explicit OFF.

## Handoff to Dev 2

Publish fixture-backed `ExtensionActivationState`, `ACTIVATION_ENABLED`,
`ACTIVATION_DISABLED`, `TranscriptSnapshotRef`, `PreferenceSnapshot`, player-event envelopes, and
`ITranscriptSnapshotReader` / `TranscriptSnapshotForSession`. Document the
contract version, event order, idempotency behavior, test evidence, and any
required HOT-file integration separately.
