# Persistent Activation Migration Rule

## Purpose

This rule governs the one-time migration from the legacy `0.1.0` Video
Activation / Manual-Auto design to the v1.2 Persistent Activation design at
contract baseline `0.4.0`.

Only the Integration Captain may execute this migration because it changes
shared contracts, message routing, shell wiring, and multiple module seams.

## Target behavior

```text
chrome.storage.local extensionEnabled
  -> ExtensionActivationState enabled
  -> `VIDEO_CONTEXT_CHANGED` before each supported replacement page
  -> one `ACTIVATION_ENABLED` event after Backend accepts a valid caption capture
  -> TranscriptCaptureRef + PreferenceSnapshot
  -> Dev 2 session and quiz flow
```

- First installation defaults to OFF.
- A saved choice is restored at browser startup.
- ON is global and survives browser restart. It starts a flow when the current watch page is captured at ON or during restored-page initialization.
- While ON, a controlled YouTube SPA transition coordinator observes supported video-ID changes, publishes `VIDEO_CONTEXT_CHANGED`, and creates a replacement flow only after transcript evidence is available. It never silently persists OFF.
- Explicit user OFF is the only event that persists OFF.
- Video classification, confidence thresholds, Auto/Manual mode, and the
  classification AI route are removed from the MVP.

## Required migration set

1. Create or update the `0.4.0` public API, internal API when applicable,
   Extension-message schemas, and JSON examples.
2. Replace `ActivationDecision` as the Dev 1 to Dev 2 entry seam with
   `ExtensionActivationState` and `ACTIVATION_ENABLED` / `ACTIVATION_DISABLED`.
3. Publish `VIDEO_CONTEXT_CHANGED`, `TranscriptCaptureRef`, `PreferenceSnapshot`, player events, and
   `ITranscriptCaptureReader` through versioned public ports. The runtime source
   is `youtubeCaption`: captionTracks -> Timedtext JSON3 -> XML, with DOM
   transcript observation only as a direct-fetch fallback.
4. Update every Extension producer and consumer: content script, service
   worker relay, Side Panel, SessionQuiz runtime, and AssessmentHistory
   consumers where affected.
5. Update Backend DTOs/use cases and FastAPI routers only for their owning
   contracts. Remove unused classification registration and tests.
6. Update contract tests, unit tests, browser smoke tests, module handoffs,
   README, AGENTS, custom agent profiles, and an ADR that records the breaking
   change.

## Safety gates

- Do not emit `0.1.0` and `0.4.0` messages into one runtime flow.
- Do not alter the global enabled setting on transcript, Backend, AI, or player
  failure.
- Do not let Dev 2 or Dev 3 access YouTube DOM or Dev 1 repositories.
- Do not expose answer keys, rubrics, prompts, or secrets in Extension data.
- Run extension typecheck/build/tests, affected contract tests, all Backend
  module tests, FastAPI tests, and Chrome/Edge manual smoke before merge.
