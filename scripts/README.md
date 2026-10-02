# StudyLens Automation & Tooling Scripts

This directory is reserved for developer utility and automation scripts, including:
- Contract code generation (`openapi-generator`, typegen)
- Schema and fixture validation
- Local environment setup and verification
- Test data seeding

## Release E2E

With the release stack healthy, run the full persisted workflow with:

```powershell
.\scripts\release-e2e.ps1
```

Use `-QuestionType shortAnswer -DurationMs 840000` for the five-question
short-answer path, or `-TranscriptStatus unavailable` to exercise the public
YouTube URL transcript fallback. The script checks public answer redaction,
evidence timestamps, duplicate prompts, attempt idempotency, and video/session
history linkage.

The script uses whichever provider the running stack exposes. Start the normal
stack with `.\release.ps1 smoke` for a live Gemini case. Start it with
`.\release.ps1 smoke -Provider fake` only when deterministic fixture output is
the intended test evidence.

## SRS/SDS maintenance

`update-week6-docs.py` updates the supplied SRS/SDS sources in place and
replaces their architecture diagrams. It requires Python 3.12 with
`python-docx` plus Graphviz `dot`. `render-docx-word.ps1` performs the final
Word-to-PDF render under `artifacts/docx-qa/`; it requires Microsoft Word on
Windows. Rendered QA files remain ignored and are not release artifacts.
