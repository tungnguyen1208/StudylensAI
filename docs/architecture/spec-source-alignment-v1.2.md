# Specification-to-source alignment - persistent activation 0.4.0

This document records the implemented update to the v1.2 persistent-activation
design. Contract files under `contracts/` are the source of truth.

| Requirement | Source | Status |
|---|---|---|
| Persistent explicit ON/OFF | `persistent-activation.ts`, service worker | Implemented |
| No classifier / no direct Extension AI | Dev 1 boundaries, Backend gateway | Implemented |
| Primary Full Text acquisition | `platform/youtube/transcript-reader.ts` | Implemented: track ranking (`manual`/ASR), `captionTracks`, JSON3 then XML, normalized timestamped cues |
| Fallback acquisition | `youtube-transcript-adapter.ts` | Direct-first is implemented; DOM expansion + observer is fallback-only. A direct-success lock is required before the runtime can claim full conformance. |
| Cue persistence/idempotency | `TranscriptCaptureEndpoints`, SQLite capture store | Implemented |
| Session handoff | `TranscriptCaptureRef` source `youtubeCaption` | Implemented only after available capture |
| A -> B while ON | SPA observer and `VIDEO_CONTEXT_CHANGED` | Implemented |
| Quiz AI boundary | Session segment -> Backend -> FastAPI question generation | Implemented |

## Final runtime

```text
ON -> YouTube captionTracks -> preferred manual/ASR track
   -> Timedtext JSON3/XML -> normalized timestamped cues
   -> DOM transcript fallback only if direct retrieval is unavailable
   -> Backend validates/persists cue-only capture, hash and idempotency
   -> ACTIVATION_ENABLED -> session/timer -> frozen segment
   -> Backend -> FastAPI quiz generation -> answer/grade/history
```

There is no runtime STT/audio capture pipeline in 0.4.0: no `tabCapture`,
offscreen document, MediaRecorder, WebM/Opus upload, transcription router, or
Gemini transcription configuration. Legacy SQLite audio tables are retained
for existing data only and receive no new writes.

If captions are absent or too short, the Extension remains ON and reports
`transcriptUnavailable`/`transcriptInsufficient`; it must not create a fake
session or quiz. A retryable Backend error keeps the exact capture idempotency
key. Once direct Timedtext is accepted, DOM mutations cannot create a second
caption capture for that acquisition. Neither path changes YouTube playback.

## Conformance follow-up

The direct-success lock is an architectural invariant, not merely UI
deduplication: an accepted Timedtext capture must stop DOM fallback emissions
for the same acquisition. This prevents a virtualized or differently localized
YouTube transcript panel from submitting a second cue set with a conflicting
canonical hash/idempotency identity. Until the adapter persists that lock, this
row remains a required implementation follow-up; it must be covered by a
direct-success-then-DOM-mutation regression test.
