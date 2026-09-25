# StudyLens AI repository map - contract 0.4.0

```text
apps/extension/src/
  shell/                         Side Panel, service worker, content script wiring
  platform/youtube/
    transcript-reader.ts          captionTracks selector + Timedtext JSON3/XML parser
    youtube-transcript-adapter.ts direct-first acquisition; DOM fallback coordinator
    youtube-player-adapter.ts     normalized playback events
  features/video-activation/     ON/OFF, preferences, caption upload/status
  features/session-quiz/         session, timer, segment, quiz
  features/assessment-history/   answer, grade, history

services/api/src/StudyLens.Api/Features/
  VideoActivation/               caption capture validation + SQLite cues
  SessionQuiz/                    frozen cue segment and FastAPI quiz gateway
  AssessmentHistory/              grading/history persistence

services/ai/app/features/
  question_generation/            stateless quiz generation
  grading/                        stateless short-answer grading

contracts/
  public-api/video-activation.yaml Extension-to-Backend caption capture API
  ai-api/                          Backend-to-FastAPI quiz/grading APIs
  extension-messages/              browser handoff schemas
  examples/                        contract fixtures
```

The public caption API is:

| Endpoint | Purpose |
|---|---|
| `POST /api/video-activation/transcript-captures` | Validate and idempotently persist normalized YouTube caption cues, hash and capture metadata |
| `GET /api/video-activation/transcript-captures/{captureId}` | Side Panel cue preview |

New records have `source: youtubeCaption` and status `available`,
`unavailable`, or `insufficient`. The retained `TranscriptAudioChunks` SQLite
table is legacy-only; no current route writes WebM/Opus or calls a
transcription provider.

Event ordering is `VIDEO_CONTEXT_CHANGED -> old session complete -> available
caption capture -> ACTIVATION_ENABLED`. FastAPI is not a transcript source; it
receives only a frozen segment from Backend to generate a quiz.

`transcript-reader.ts` is the Full Text path. It reads `captionTracks`, ranks
the requested-language manual track before ASR where available, fetches
Timedtext JSON3 then XML, and normalizes `{ startMs, endMs, text }`. The
adapter opens/observes YouTube's DOM transcript only when direct Timedtext is
unavailable. A direct capture accepted by Backend ends that fallback decision
for the acquisition; DOM rows must not generate a duplicate capture.
