# StudyLens AI repository map - contract 0.5.0

```text
apps/extension/src/
  shell/                         Side Panel, service worker, content script wiring
  platform/youtube/
    transcript-reader.ts          captionTracks selector + Timedtext JSON3/XML parser
    youtube-transcript-adapter.ts direct-first acquisition; DOM fallback coordinator
    youtube-player-adapter.ts     normalized playback events
  features/video-activation/     ON/OFF, preferences, caption upload/status
  features/session-quiz/         immediate session, full transcript, quiz
  features/assessment-history/   answer, grade, history

services/api/src/StudyLens.Api/Features/
  VideoActivation/               persistent activation/page boundaries
  SessionQuiz/                    full transcript/job persistence and AI gateway
  AssessmentHistory/              grading/history persistence

services/ai/app/features/
  question_generation/            stateless full-video quiz generation
  transcript_generation/          public-video fallback cue generation
  grading/                        stateless short-answer grading

contracts/
  public-api/session-quiz.yaml    Extension-to-Backend session/transcript API
  ai-api/                          Backend-to-FastAPI quiz/grading APIs
  extension-messages/              browser handoff schemas
  examples/                        contract fixtures
```

The public learning API is:

| Endpoint | Purpose |
|---|---|
| `POST /api/sessions` | Create the immediate session for ON + a valid video |
| `PUT /api/sessions/{sessionId}/transcript` | Validate and idempotently persist one normalized full transcript |
| `GET /api/sessions/{sessionId}/learning-package` | Return transcript/quiz processing state and public quiz |
| `POST /api/sessions/{sessionId}/retry` | Retry the failed fallback or quiz step without duplicating work |

New records have `source: youtubeCaption` and status `available`,
`unavailable`, or `insufficient`. The retained `TranscriptAudioChunks` SQLite
table is legacy-only; no current route writes WebM/Opus or calls a
transcription provider.

Event ordering is `VIDEO_CONTEXT_CHANGED -> old session complete ->
ACTIVATION_ENABLED -> immediate replacement session -> full transcript`.
FastAPI receives a Backend-owned full transcript to generate a quiz and can
receive a public YouTube URL only for fallback.

`transcript-reader.ts` is the Full Text path. It reads `captionTracks`, ranks
the requested-language manual track before ASR where available, fetches
Timedtext JSON3 then XML, and normalizes `{ startMs, endMs, text }`. The
adapter opens/observes YouTube's DOM transcript only when direct Timedtext is
unavailable. A direct capture accepted by Backend ends that fallback decision
for the acquisition; DOM rows must not generate a duplicate capture.
