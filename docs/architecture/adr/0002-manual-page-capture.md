# ADR 0002 Manual page capture for persistent activation

## Status

Accepted on 2026-09-20.

## Context

The supplied v1.2 SRS and SDS contain some automatic page-change behavior.
That behavior conflicts with this repository's product decision: the learner
explicitly controls one learning target through ON and OFF.

## Decision

`extensionEnabled` remains a global value in `chrome.storage.local`: the first
installation is OFF and the saved choice is restored on a later browser
launch.

The Extension does not continuously monitor pages, observe SPA route changes,
or automatically replace a session. When a learner turns ON on a supported
YouTube watch page, the content script captures that page once and publishes
`ACTIVATION_ENABLED`. The event envelope supplies the captured
`youtubeVideoId`; its payload supplies `PreferenceSnapshot` and, once
available, `TranscriptSnapshotRef`.

When the learner turns OFF, Dev 1 publishes `ACTIVATION_DISABLED`; Dev 2
completes the active session idempotently and stops timing. To study another
video, the learner turns StudyLens OFF and then ON again. A changed page must
not silently change the persisted ON/OFF setting.

## Consequences

- Dev 2 starts only from `ACTIVATION_ENABLED` and completes only from
  `ACTIVATION_DISABLED`, player end, or another explicit lifecycle condition.
- A bound player may reject events that no longer belong to its captured video,
  but it does not publish a replacement page or create a new session.
- Side Panel status describes the captured page and tells the learner to use
  OFF then ON after changing video.
- The migration to baseline `0.2.0` updates contracts, worker, content script,
  Side Panel, SessionQuiz consumer, fixtures and tests atomically.

## Source precedence

This ADR resolves the v1.2 SRS/SDS wording for this repository. It does not
edit the supplied DOCX files; inconsistent automatic-switch clauses are
tracked in the alignment report.
