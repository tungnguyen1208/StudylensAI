# Vertical Feature Workflow

Use this workflow for Dev 1, Dev 2, or Dev 3 feature implementation.

## Steps

1. Identify the owner module and task id.
2. Inspect existing contracts and code in that module only.
3. Update the contract first if the API surface changes.
4. Implement the smallest end-to-end feature slice.
5. Keep endpoints, routers, and React components thin.
6. Add module tests and contract examples.
7. Run only relevant verification commands first, then broader checks when shared boundaries changed.
8. Update docs if behavior or contract changed.

## Done Means

The feature has a working path through every applicable layer:

```text
Extension UI/integration
    + Backend endpoint/use case/persistence
    + FastAPI AI logic if needed
    + contract examples
    + tests
    + failure handling
```

Do not mark a feature complete just because one layer compiles.
