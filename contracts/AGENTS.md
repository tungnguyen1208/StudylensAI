# Contract Agent Rules

These rules apply when Codex starts inside `contracts`.

- Treat contracts as the source of truth for integration.
- Public API contracts describe Extension -> Backend behavior.
- AI API contracts describe Backend -> FastAPI behavior.
- Extension message schemas describe content script, service worker, and side panel messages.
- Use contract version `0.3.0` unless an integration task explicitly changes it.
- Do not expose correct answers, rubrics, reference answers, secrets, or hidden prompts in public Extension responses.
- Keep JSON field names `camelCase`, enums as strings, video timestamps in milliseconds, and system timestamps in ISO-8601 UTC.
