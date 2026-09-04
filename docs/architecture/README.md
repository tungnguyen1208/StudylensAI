# StudyLens Architecture

## Base Walking Skeleton

```text
YouTube Web
    -> Chrome/Edge Extension
    -> HTTP REST
ASP.NET Core Backend
    |-- SQLite
    -> FastAPI AI Service
    -> LLM Provider
```

## Ownership

### Extension

- YouTube integration
- Side Panel UI
- session/client-side video state
- player control

### ASP.NET Backend

- application logic
- persistence
- session/history/settings
- AI orchestration

### FastAPI

- transcript processing
- classification
- question generation
- short-answer grading
- AI output validation

### LLM provider

- model inference only

## Current Boundary

The extension calls only the ASP.NET Core Backend. The backend owns persistence and calls the FastAPI AI Service through `AIServiceClient`. The AI service owns future AI processing and depends on an abstract LLM client instead of a concrete model vendor.

