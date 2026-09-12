# Integration Captain Workflow

Use this workflow when a task intentionally touches shared/HOT files or stitches
multiple vertical modules together.

## Steps

1. Read all affected module contracts.
2. List the HOT files that need edits before changing them.
3. Keep shared edits minimal and compatible with all three modules.
4. Wire adapters through published ports, not internal repositories.
5. Run full Extension, Backend, and AI verification.
6. Write a short integration note covering affected modules, contract changes, and commands run.

## Required Checks

```powershell
cd apps/extension
npm run typecheck
npm run build
```

```powershell
dotnet build services/api/src/StudyLens.Api/StudyLens.Api.csproj
dotnet test services/api/tests/VideoActivation.Tests/VideoActivation.Tests.csproj
dotnet test services/api/tests/SessionQuiz.Tests/SessionQuiz.Tests.csproj
dotnet test services/api/tests/AssessmentHistory.Tests/AssessmentHistory.Tests.csproj
```

```powershell
cd services/ai
python -m pytest
python -c "from app.main import app; print(app.title)"
```
