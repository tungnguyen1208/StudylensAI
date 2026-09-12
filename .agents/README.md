# StudyLens Codex Workspace

This folder contains repo-local guidance for Codex-driven development.

```text
.agents/
├── README.md
├── rules/
│   ├── common-dev-rules.md
│   ├── api-contract-rules.md
│   ├── module-boundary-rules.md
│   └── dev/
│       ├── dev1-video-activation.md
│       ├── dev2-session-quiz.md
│       └── dev3-assessment-history.md
├── playbooks/
│   ├── vertical-feature-workflow.md
│   └── integration-captain-workflow.md
└── skills/
    ├── studylens-vertical-feature/
    ├── studylens-contract-first/
    └── studylens-integration-captain/
```

Responsibilities:

- `AGENTS.md` files are loaded automatically by Codex as project guidance.
- `.agents/rules/` stores human-readable rules and checklists.
- `.agents/playbooks/` stores step-by-step workflows for recurring work.
- `.agents/skills/` stores repo-specific Codex skills that can be invoked with `$skill-name`.
- `.codex/agents/` stores project-scoped custom agent profiles.

Start here when using Codex:

1. Read root `AGENTS.md`.
2. Read the closest nested `AGENTS.md` for the folder you will edit.
3. Read `.agents/rules/common-dev-rules.md`.
4. Read your role file in `.agents/rules/dev/`.
5. Use a repo skill when the task matches one of the workflows.
6. Use a custom agent profile only when the user asks for a specific dev role or parallel agent work.
