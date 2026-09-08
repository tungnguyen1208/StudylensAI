# Extension Agent Rules

These rules apply when Codex starts inside `apps/extension`.

- Keep raw YouTube DOM and player access in `src/platform/youtube/**`.
- Keep React components free of AI prompts, persistence logic, and raw DOM scraping.
- The Extension calls only the ASP.NET Core Backend through shared HTTP or feature API clients.
- Do not call FastAPI or LLM providers directly.
- Internal messages must follow the contract envelope in `contracts/extension-messages/`.
- Run `npm run typecheck` and `npm run build` after TypeScript changes.
