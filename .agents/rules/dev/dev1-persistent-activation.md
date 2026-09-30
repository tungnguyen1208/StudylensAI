# StudyLens Dev 1 - Persistent Activation and Caption Acquisition

## Role

Dev 1 owns explicit persistent ON/OFF, the YouTube watch-page integration,
caption acquisition, PlayerPort, local preferences and the public handoff to
Dev 2. There is no video classifier, auto mode, microphone, STT, tabCapture,
MediaRecorder or direct AI call.

```text
chrome.storage.local extensionEnabled
  -> supported YouTube watch page + PlayerPort
  -> captionTracks -> manual/ASR language selection
  -> Timedtext JSON3, then XML -> DOM transcript fallback when unavailable
  -> immediate Backend session -> full caption upload
  -> Backend validation/fallback -> Dev 2 SessionQuiz
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
   request Timedtext JSON3 then XML, decode/normalize/deduplicate
   `{ startMs, endMs, text }` cues, and send cue-only JSON to Backend. Direct
   Timedtext is the Full Text path because it returns the selected YouTube
   track; do not depend on the currently visible video subtitle line.
3. If and only if direct retrieval is unavailable, Dev 1 may open YouTube's
   transcript UI and observe its rendered segments with a debounced
   `MutationObserver`. DOM rows are volatile/possibly partial. Once Backend
   accepts a direct capture, ignore later DOM mutations for that acquisition so
   they cannot create a second capture with a different language or hash.
4. Cancel stale fetch/DOM work on OFF, A -> B, and leaving `/watch`. Publish
   `VIDEO_CONTEXT_CHANGED` once before replacement work and publish
   `ACTIVATION_ENABLED` immediately for the replacement session.
5. Send one full cue payload to that session. `unavailable` and `insufficient`
   keep global ON and allow the Backend-owned public-video fallback; Backend
   network failure is retryable and reuses the same transcript idempotency key.
6. Only explicit OFF publishes `ACTIVATION_DISABLED`. Never pause, seek, play,
   or otherwise alter YouTube on any normal/error path.

## Handoff rules

- Contract baseline is `0.5.0`; camelCase, integer video milliseconds and UTC
  timestamps apply.
- The upload source is `youtubeCaption`; it contains no raw DOM payload,
  audio, quiz answer, or secret. Backend owns canonical cue hash, idempotency
  and persistence.
- Dev 2 creates the session first, then processes the Backend-persisted full
  transcript. FastAPI only receives a public YouTube URL for the explicit
  Gemini fallback after direct captions are unavailable or insufficient.
- Keep `PreferenceSnapshot` immutable for each activation.

## Acceptance evidence

Unit coverage must include JSON3/XML parsing, entities, language/manual-track
selection, direct-first DOM fallback, hash/replay, missing captions, stale A
-> B/OFF work, and no activation before a valid capture. Chrome/Edge smoke
must include manual captions, ASR captions, missing captions, A -> B while ON,
Backend outage, and unchanged YouTube playback.
