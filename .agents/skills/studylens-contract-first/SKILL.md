---
name: studylens-contract-first
description: Use when adding or changing StudyLens API contracts, DTOs, extension messages, OpenAPI files, or cross-module integration boundaries.
---

# StudyLens Contract-First Skill

Use this skill before implementing API changes.

## Required Context

Read:

1. `AGENTS.md`
2. `.agents/rules/api-contract-rules.md`
3. `.agents/rules/module-boundary-rules.md`
4. Relevant files in `contracts/`

## Workflow

1. Identify whether the change is public Extension -> Backend, internal Backend -> AI, or Extension messaging.
2. Update the contract file first.
3. Add or update examples in `contracts/examples/<module>/`.
4. Update DTOs and schemas in each affected layer.
5. Add contract or module tests.
6. Confirm public responses do not leak hidden answers or rubrics.

## Output

In the final response, include:

- Contract files changed.
- Consumer files changed.
- Producer files changed.
- Tests run.
- Any compatibility notes for other devs.
