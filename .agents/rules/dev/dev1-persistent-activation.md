# StudyLens Dev 1 - Persistent Activation and Caption Acquisition

## Role

Dev 1 owns explicit persistent ON/OFF, the YouTube watch-page integration,
caption acquisition, PlayerPort, local preferences and the public handoff to
Dev 2. There is no video classifier, auto mode, microphone, STT, tabCapture,
MediaRecorder or direct AI call.

```text
chrome.storage.local extensionEnabled
  -> supported YouTube watch page + PlayerPort
  -> captionTracks Timedtext -> DOM transcript fallback
  -> Backend caption capture -> TranscriptCaptureRef
  -> Dev 2 SessionQuiz
```

## Allowed paths

```text
apps/extension/src/platform/youtube/**
apps/extension/src/features/video-activation/**
services/api/tests/VideoActivation.Tests/**
contracts/public-api/video-activation.yaml
contracts/extension-messages/video-activation.schema.json
contracts/examples/video-activation/**
tests/contract/video-activation/**
```

## Required behavior

1. Persist only the learner's explicit global toggle; restore it on browser
   start. A restored ON must run the normal caption acquisition path.
2. While ON, read `captionTracks`, select the preferred manual/ASR language,
   request Timedtext JSON3 then XML, normalize cues, and send cue-only JSON to
   Backend. If direct retrieval fails, Dev 1 may open YouTube's transcript UI
   and observe its rendered segments with a debounced `MutationObserver`.
3. Cancel stale fetch/DOM work on OFF, A -> B, and leaving `/watch`. Publish
   `VIDEO_CONTEXT_CHANGED` once before replacement work. Do not publish
   `ACTIVATION_ENABLED` until Backend returns an available `youtubeCaption`
   `TranscriptCaptureRef`.
4. `unavailable` and `insufficient` are explicit non-retryable states: global
   ON remains, but no session, segment or quiz is created. Backend/network
   failure is retryable and reuses the same caption idempotency key.
5. Only explicit OFF publishes `ACTIVATION_DISABLED`. Never pause, seek, play,
   or otherwise alter YouTube on any normal/error path.

## Handoff rules

- Contract baseline is `0.4.0`; camelCase, integer video milliseconds and UTC
  timestamps apply.
- `TranscriptCaptureRef.source` is only `youtubeCaption`; it contains no raw
  DOM payload, audio, quiz answer, or secret.
- Dev 2 reads persisted cues through `ITranscriptCaptureReader` and freezes a
  segment before Backend calls FastAPI to generate a quiz.
- Keep `PreferenceSnapshot` immutable for each activation.

## Acceptance evidence

Unit coverage must include JSON3/XML parsing, entities, language/manual-track
selection, direct-first DOM fallback, hash/replay, missing captions, stale A
-> B/OFF work, and no activation before a valid capture. Chrome/Edge smoke
must include manual captions, ASR captions, missing captions, A -> B while ON,
Backend outage, and unchanged YouTube playback.
