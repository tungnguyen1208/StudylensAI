# StudyLens AI

StudyLens AI is a Chrome/Edge extension that turns an explicitly enabled
YouTube watch page into a learning session, quiz, result and history flow.

## Current design - contract 0.4.0

```text
Learner ON
  -> YouTube captionTracks -> preferred manual/ASR track
  -> Timedtext JSON3, then XML -> normalized `{ startMs, endMs, text }` cues
  -> auto-opened YouTube Transcript DOM fallback only if direct fetch is unavailable
  -> ASP.NET Core Backend validates + stores normalized cues in SQLite
  -> ACTIVATION_ENABLED -> session/timer -> frozen segment
  -> Backend -> FastAPI question generation -> quiz -> grade/history
```

The Extension does not call FastAPI, Gemini, an LLM provider or SQLite. The
AI service is used only by Backend after a valid transcript segment is frozen.

### Transcript policy

- `youtubeCaption` is the sole runtime transcript source.
- Direct Timedtext retrieval is the Full Text path: it reads the selected
  YouTube caption track, preserves timestamps and completes before a quiz can
  be considered. DOM transcript observation is a fallback, runs only while
  StudyLens is ON, and may be partial because YouTube virtualizes rows.
- A direct capture accepted by Backend wins for that acquisition. Later DOM
  mutations must not upload a second capture with a different track/language
  or idempotency hash.
- Missing or insufficient captions leave global ON enabled and show an
  explicit status. No session or quiz is fabricated.
- StudyLens does not use microphone, STT, `tabCapture`, offscreen documents,
  MediaRecorder, audio upload or `youtube-transcript-api`.
- Historical SQLite audio-capture rows are retained as legacy data, but no new
  audio records are written.

Backend checks the video ID, timestamp bounds, normalized cue content,
canonical hash and idempotency key before persisting a cue-only capture. When
the configured learning interval is met, it freezes the relevant cues in a
segment and only then calls FastAPI for quiz generation. FastAPI never fetches
or reconstructs a YouTube transcript.

### Persistent activation

First install defaults to OFF. The choice is stored locally and restored after
browser restart. When YouTube SPA changes from video A to B while ON,
StudyLens publishes one `VIDEO_CONTEXT_CHANGED`, cancels A work and enables B
only after B has an available Backend caption capture. Explicit OFF is the
only event that persists OFF. Errors never alter YouTube playback.

## Local run

Use commands relative to the repository root:

```cmd
cd /d apps\extension
npm.cmd install
npm.cmd test
npm.cmd run typecheck
npm.cmd run build

cd /d ..\..
dotnet test .\services\api\StudyLens.sln

cd /d services\ai
py -m pytest app -q
```

Load `apps/extension/dist` as an unpacked extension after `npm.cmd run build`.
When reloading the extension in Chrome/Edge, reload the YouTube page too so
the current content script is injected.

## Local configuration

Copy `.env.example` to ignored `.env` if a cloud LLM is used for quiz
generation or grading. `GEMINI_API_KEY` remains server-side in FastAPI and is
never copied into Extension source, a browser message, or a contract fixture.
`LLM_PROVIDER=fake` is the deterministic test default.

See [architecture documentation](docs/architecture/README.md),
[repository map](docs/architecture/repository-map.md), and
[project rules](AGENTS.md).
