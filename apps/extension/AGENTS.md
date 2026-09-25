# Extension Agent Rules

These rules apply when Codex starts inside `apps/extension`.

- Keep raw YouTube DOM and player access in `src/platform/youtube/**`.
- Acquire captions in that platform boundary: select `captionTracks`, fetch
  Timedtext JSON3 then XML, and use transcript DOM observation only as a
  direct-fetch fallback. Do not create a second upload from DOM after direct
  Timedtext has been accepted for the same video acquisition.
- Keep React components free of AI prompts, persistence logic, and raw DOM scraping.
- The Extension calls only the ASP.NET Core Backend through shared HTTP or feature API clients.
- Do not call FastAPI or LLM providers directly.
- Send normalized cue-only JSON to Backend; never send audio, raw DOM payloads,
  provider secrets, or private AI prompts.
- Internal messages must follow the contract envelope in `contracts/extension-messages/`.
- Run `npm run typecheck` and `npm run build` after TypeScript changes.
