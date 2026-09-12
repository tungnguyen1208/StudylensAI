---
name: studylens-vertical-feature
description: Use when implementing a StudyLens vertical feature for Dev 1, Dev 2, or Dev 3 across Extension, Backend, AI, contracts, and tests.
---

# StudyLens Vertical Feature Skill

Follow this workflow for feature tasks inside StudyLens AI.

## Required Context

Read these files before editing:

1. `AGENTS.md`
2. `.agents/rules/common-dev-rules.md`
3. `.agents/rules/module-boundary-rules.md`
4. `.agents/playbooks/vertical-feature-workflow.md`
5. The assigned role file in `.agents/rules/dev/`.

## Workflow

1. State which dev/module owns the task.
2. Inspect contracts before implementation.
3. Keep edits inside owned paths unless the user explicitly authorizes integration work.
4. Implement a small vertical slice across all required layers.
5. Keep UI, endpoint, and router files thin.
6. Add focused tests in the owner test path.
7. Run relevant build/test commands.
8. Report touched paths, changed contracts, commands run, and remaining gaps.

## Boundaries

- Do not call FastAPI directly from the Extension.
- Do not add LLM keys to the Extension.
- Do not import internal repositories/services from another module.
- Do not introduce infrastructure such as Redis, Kafka, Kubernetes, or Vector DB for MVP feature work.
