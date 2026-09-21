# ADR 0002 Controlled page transition for persistent activation

## Status

Accepted on 2026-09-20.

## Context

The revised six-week plan requires a learner to keep StudyLens ON while moving
between supported YouTube videos. The prior manual-only design required an
OFF/ON cycle and could leave the active session bound to a stale page.

## Decision

`extensionEnabled` remains a global value in `chrome.storage.local`: the first
installation is OFF and the saved choice is restored on a later browser
launch.

When the learner turns ON on a supported YouTube watch page, the content script
captures that page and publishes `ACTIVATION_ENABLED` only after transcript
evidence is available. While ON, a controlled coordinator listens only for
supported YouTube SPA video-ID transitions. It publishes
`VIDEO_CONTEXT_CHANGED` with the old activation identity before it captures the
replacement page. The envelope `youtubeVideoId` is the replacement ID; the
payload has `transitionId`, `previousActivationId`,
`previousYoutubeVideoId`, and the replacement title.

When the learner turns OFF, Dev 1 publishes `ACTIVATION_DISABLED`; Dev 2
completes the active session idempotently and stops timing. A supported page
change never changes the persisted ON/OFF setting. It closes only the matching
old flow, and Dev 2 starts the replacement only after its later valid
`ACTIVATION_ENABLED` handoff.

## Consequences

- Dev 2 starts only from `ACTIVATION_ENABLED`; it completes the matching old
  session on `VIDEO_CONTEXT_CHANGED`, `ACTIVATION_DISABLED`, player end, or
  another explicit lifecycle condition.
- Dev 1 disposes stale player/transcript work before binding the replacement
  page. Stale A events or upload completions cannot activate B.
- Side Panel status distinguishes the active page, transition, transcript
  pending/unavailable states, and explicit OFF.
- The migration to baseline `0.2.0` updates contracts, worker, content script,
  Side Panel, SessionQuiz consumer, fixtures and tests atomically.

## Source precedence

This ADR is the repository decision for the revised six-week plan. It preserves
the no-classification boundary and does not edit the supplied DOCX files.
