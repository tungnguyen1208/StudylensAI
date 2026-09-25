# Contract Agent Rules

These rules apply when Codex starts inside `contracts`.

- Treat contracts as the source of truth for integration.
- Public API contracts describe Extension -> Backend behavior.
- AI API contracts describe Backend -> FastAPI behavior.
- Extension message schemas describe content script, service worker, and side panel messages.
- Use contract version `0.4.0` unless an integration task explicitly changes it.
- Transcript capture uses only `TranscriptCaptureRef.source: youtubeCaption`.
  Capture requests contain normalized timestamped cues and metadata, never raw
  audio, DOM markup, provider payloads, or API keys. An available capture is
  the prerequisite for `ACTIVATION_ENABLED` and a session.
- Do not expose correct answers, rubrics, reference answers, secrets, or hidden prompts in public Extension responses.
- Keep JSON field names `camelCase`, enums as strings, video timestamps in milliseconds, and system timestamps in ISO-8601 UTC.
