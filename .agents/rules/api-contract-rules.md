# API Contract Rules

The `contracts/` folder is the integration boundary for the three vertical
modules and their Codex sessions.

## Contract Locations

Public Extension -> Backend contracts:

```text
contracts/public-api/root.yaml
contracts/public-api/video-activation.yaml
contracts/public-api/session-quiz.yaml
contracts/public-api/assessment-history.yaml
```

Internal Backend -> AI contracts:

```text
contracts/ai-api/root.yaml
contracts/ai-api/question-generation.yaml
contracts/ai-api/grading.yaml
```

Extension message schemas:

```text
contracts/extension-messages/video-activation.schema.json
contracts/extension-messages/session-quiz.schema.json
contracts/extension-messages/assessment-history.schema.json
```

## Change Rule

The target baseline is `0.4.0`. Migrating from `0.1.0` is an Integration
Captain task and must update every producer and consumer atomically; no bridge
may emit both versions into the same feature flow without an ADR.

Any API change must update all affected artifacts in the same task:

1. Contract YAML or JSON schema.
2. Request/response DTOs.
3. Extension API types or feature client.
4. Backend endpoint/use case.
5. FastAPI Pydantic schema/router when affected.
6. Contract examples.
7. Tests.

## Transcript Capture Boundary

At `0.4.0`, the Video Activation public API accepts only normalized
`youtubeCaption` cues and capture metadata from Extension. It must carry the
video ID, cue timestamps, canonical content identity and idempotency identity;
it must never carry raw audio, WebM/Opus blobs, DOM markup, provider responses
or API keys. Backend returns an available `TranscriptCaptureRef` before the
Extension emits `ACTIVATION_ENABLED`.

The AI API has a narrower role: Backend sends a frozen cue segment for quiz
generation or grading. FastAPI must not be specified as a transcript source.

## Public Response Safety

Before answer submit, public Extension responses may include question content,
options, timestamps, and source references. They must not include:

- `correctAnswer`
- grading rubric
- reference answer for short answer
- hidden prompt content

## Error Envelope

Feature APIs should use a predictable error shape:

```json
{
  "code": "string",
  "status": 400,
  "message": "string",
  "traceId": "string",
  "retryable": false
}
```

Do not leak stack traces, provider secrets, connection strings, or raw LLM output
in public responses.
