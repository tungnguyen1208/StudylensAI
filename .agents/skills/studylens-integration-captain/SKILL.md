---
name: studylens-integration-captain
description: Use for StudyLens integration work that touches shared HOT files, root contracts, module wiring, migrations, release checks, or cross-module conflict resolution.
---

# StudyLens Integration Captain Skill

Use this skill only for explicit integration tasks.

## Required Context

Read:

1. `AGENTS.md`
2. `.agents/rules/common-dev-rules.md`
3. `.agents/rules/api-contract-rules.md`
4. `.agents/rules/module-boundary-rules.md`
5. `.agents/playbooks/integration-captain-workflow.md`

## Workflow

1. Name the shared/HOT files that need edits.
2. Check current Git status before changing files.
3. Keep integration changes minimal.
4. Wire modules through public contracts or application ports.
5. Run full verification across Extension, Backend, and AI.
6. Report affected modules and compatibility risks.

## Guardrails

- Do not rewrite unrelated module code.
- Do not create full database schema for another dev's unfinished module.
- Do not change stack choices without explicit user approval.
- Do not continue into A/B/C feature implementation unless the user asks.
