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
contracts/ai-api/classification.yaml
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

Any API change must update all affected artifacts in the same task:

1. Contract YAML or JSON schema.
2. Request/response DTOs.
3. Extension API types or feature client.
4. Backend endpoint/use case.
5. FastAPI Pydantic schema/router when affected.
6. Contract examples.
7. Tests.

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
  "message": "string",
  "correlationId": "string"
}
```

Do not leak stack traces, provider secrets, connection strings, or raw LLM output
in public responses.
