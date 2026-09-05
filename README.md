# StudyLens AI

StudyLens AI is a Chrome / Edge browser extension designed to help learners actively absorb and retain knowledge from YouTube Web videos via dynamic transcript extraction and AI-generated quizzes.

This repository is structured as a **Modular Monorepo Framework** enabling 3 developers (or 3 Codex instances) to develop end-to-end vertical feature slices concurrently without merge conflicts or shared boundary violations.

---

## 1. System Architecture

```text
YouTube Web
    │
    ▼
StudyLens Browser Extension (MV3)
    │
    │ HTTP / REST (Public API)
    ▼
ASP.NET Core 8 Web API Backend
    ├── SQLite Database (Business state & persistence)
    │
    │ Internal HTTP / REST
    ▼
FastAPI AI Service
    │
    ▼
LLM Provider (Abstracted: fake / vLLM / Cloud)
```

### Architectural Principles
1. **Extension Boundary:** Extension only communicates with the ASP.NET Core Backend via HTTP/REST. It contains no LLM keys, no database connections, and does not call FastAPI directly.
2. **Backend Authority:** ASP.NET Core is the single authority for business state, persistence, user sessions, and AI orchestration.
3. **Stateless AI Service:** FastAPI is strictly stateless and processes inputs via structured Pydantic schemas.
4. **Independent Vertical Ownership:** Each developer owns their slice across Extension, Backend, AI Service, Contracts, and Tests.

---

## 2. Repository Structure

```text
studylens/
├── AGENTS.md                          # Repository rulebook
├── README.md                          # Repository entry point & guide
├── .gitignore                         # Multi-stack gitignore
├── .editorconfig                      # Code formatting standard
├── .env.example                       # Safe configuration placeholder template
│
├── apps/
│   └── extension/                     # Chrome / Edge Manifest V3 Extension (React + TS + Vite)
│       ├── manifest.json              # Extension manifest
│       ├── vite.config.ts             # Bundler configuration
│       └── src/
│           ├── shell/                 # Shell & integration entry points (HOT)
│           ├── platform/youtube/      # YouTube DOM & player adapter (Dev 1)
│           ├── features/              # Feature modules (Dev 1, Dev 2, Dev 3)
│           ├── shared/                # HTTP client, error models, messaging
│           └── generated/             # Auto-generated schemas/clients
│
├── services/
│   ├── api/                           # ASP.NET Core 8 Backend
│   │   ├── src/StudyLens.Api/         # API Web Application
│   │   │   ├── Features/              # VideoActivation, SessionQuiz, AssessmentHistory
│   │   │   ├── BuildingBlocks/        # Health, Errors, Http clients
│   │   │   └── Infrastructure/        # EF Core DbContext & Migrations
│   │   └── tests/                     # Isolated xUnit test projects per module
│   │       ├── VideoActivation.Tests/
│   │       ├── SessionQuiz.Tests/
│   │       └── AssessmentHistory.Tests/
│   │
│   └── ai/                            # FastAPI AI Service
│       ├── app/
│       │   ├── main.py                # App factory & router registration (HOT)
│       │   ├── platform/              # Config, health, LLM provider abstractions
│       │   └── features/              # classification, question_generation, grading
│       ├── requirements.txt
│       └── pyproject.toml
│
├── contracts/                         # Source of truth for API contracts (Baseline 0.1.0)
│   ├── public-api/                    # Extension ↔ Backend OpenAPI contracts
│   ├── ai-api/                        # Backend ↔ FastAPI OpenAPI contracts
│   ├── extension-messages/            # Browser internal JSON schema message envelopes
│   └── examples/                      # Contract fixtures and test payloads
│
├── tests/                             # Integration & Contract Tests
│   ├── contract/                      # Contract compatibility tests per module
│   └── e2e/                           # E2E test suites per module
│
├── docs/                              # Project documentation
│   └── architecture/                  # Architecture specs and module ownership matrix
├── scripts/                           # Tooling and validation scripts
└── deploy/                            # Deployment manifests placeholder
```

---

## 3. Module Ownership Matrix

| Feature Module | Developer Owner | Extension Feature | Backend Feature | AI Feature | Contracts |
|---|---|---|---|---|---|
| **Video Activation** | **Dev 1** | `features/video-activation/`<br>`platform/youtube/` | `Features/VideoActivation/` | `features/classification/` | `video-activation.yaml`<br>`classification.yaml` |
| **Session & Quiz** | **Dev 2** | `features/session-quiz/` | `Features/SessionQuiz/` | `features/question_generation/` | `session-quiz.yaml`<br>`question-generation.yaml` |
| **Assessment & History** | **Dev 3** | `features/assessment-history/` | `Features/AssessmentHistory/` | `features/grading/` | `assessment-history.yaml`<br>`grading.yaml` |

### Shared & HOT Files
Developers 1, 2, and 3 must not modify shared HOT files in daily feature tasks. Integration changes are managed by the Integration Captain:
- `AGENTS.md`
- `apps/extension/manifest.json`, `vite.config.ts`, `src/shell/**`
- `services/api/src/StudyLens.Api/Program.cs`, `BuildingBlocks/**`, `StudyLensDbContext.cs`
- `services/ai/app/main.py`, `app/platform/**`
- `contracts/public-api/root.yaml`, `contracts/ai-api/root.yaml`

---

## 4. Environment Prerequisites

- **Node.js**: v18+ (tested with v22.18.0) and `npm`
- **.NET SDK**: .NET 8.0 SDK (tested with 10.0.101 supporting .NET 8)
- **Python**: 3.12+ (tested with 3.13.7)

---

## 5. Local Development Commands

### 5.1 Browser Extension

```powershell
cd apps/extension
npm install
npm run build
```

To load unpacked in Chrome or Edge:
1. Navigate to `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `apps/extension/dist`.
4. Open any YouTube video and click the StudyLens side panel icon.

### 5.2 ASP.NET Core Backend

```powershell
# Build API
dotnet build services/api/src/StudyLens.Api/StudyLens.Api.csproj

# Run API (defaults to http://localhost:5000)
dotnet run --project services/api/src/StudyLens.Api/StudyLens.Api.csproj
```

**Health endpoints:**
- `GET http://localhost:5000/api/health` — Backend API health check
- `GET http://localhost:5000/api/health/ai` — Backend to AI Service health check proxy
- Swagger UI: `http://localhost:5000/swagger`

**Backend Tests:**
```powershell
dotnet test services/api/tests/VideoActivation.Tests/VideoActivation.Tests.csproj
dotnet test services/api/tests/SessionQuiz.Tests/SessionQuiz.Tests.csproj
dotnet test services/api/tests/AssessmentHistory.Tests/AssessmentHistory.Tests.csproj
```

### 5.3 FastAPI AI Service

```powershell
cd services/ai
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Run AI service (defaults to http://localhost:8000)
uvicorn app.main:app --reload --port 8000
```

**Health endpoint:**
- `GET http://localhost:8000/health` — FastAPI service health check

---

## 6. Verification Status

The walking skeleton verifies the complete end-to-end communication path:
- Extension builds cleanly and connects to Backend via typed `HttpClient`.
- Backend responds on `/api/health` and queries AI service via `AiHealthClient`.
- FastAPI AI service responds on `/health` and has all 3 feature routers registered.
- All 3 backend module test suites pass.
