# Specification-to-source alignment - persistent activation 0.4.0

This document records the implemented update to the v1.2 persistent-activation
design. Contract files under `contracts/` are the source of truth.

| Requirement | Source | Status |
|---|---|---|
| Persistent explicit ON/OFF | `persistent-activation.ts`, service worker | Implemented |
| No classifier / no direct Extension AI | Dev 1 boundaries, Backend gateway | Implemented |
| Primary caption acquisition | `platform/youtube/transcript-reader.ts` | Implemented: `captionTracks`, JSON3 then XML |
| Fallback acquisition | `youtube-transcript-adapter.ts` | Implemented: optional DOM expansion + observer while ON |
| Cue persistence/idempotency | `TranscriptCaptureEndpoints`, SQLite capture store | Implemented |
| Session handoff | `TranscriptCaptureRef` source `youtubeCaption` | Implemented only after available capture |
| A -> B while ON | SPA observer and `VIDEO_CONTEXT_CHANGED` | Implemented |
| Quiz AI boundary | Session segment -> Backend -> FastAPI question generation | Implemented |

## Final runtime

```text
ON -> YouTube captionTracks -> Timedtext JSON3/XML
   -> DOM transcript fallback -> Backend validates/persists cue-only capture
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
key. Neither path changes YouTube playback.
