# StudyLens AI

StudyLens AI is a Chrome / Edge browser extension designed to help learners actively absorb and retain knowledge from YouTube Web videos via dynamic transcript extraction and AI-generated quizzes.

This repository is structured as a **Modular Monorepo Framework** enabling 3 developers (or 3 Codex instances) to develop end-to-end vertical feature slices concurrently without merge conflicts or shared boundary violations.

---

## 1. MVP Product Scope

StudyLens turns a supported YouTube Web video into an active-learning session:

1. The learner controls a single global ON/OFF switch. The value is stored in `chrome.storage.local`, defaults to OFF only on first installation, and is restored after browser restart.
2. On ON, the content script captures the current supported YouTube watch page and starts a learning flow for that explicit learner choice. While ON, a supported YouTube SPA video change closes the old flow and captures the replacement page without changing the persisted ON/OFF setting. If navigation leaves a supported watch page, global ON waits for a later supported page rather than silently turning OFF.
3. On explicit OFF, the active learning flow stops and the persisted setting becomes OFF. Transcript, Backend, player, or navigation failures never silently turn the global setting OFF.
4. Track only actual playback time; paused time never counts toward the selected 5, 10, or 15-minute interval.
5. Preserve transcript timestamps, create an evidence-backed segment, then generate a multiple-choice or short-answer quiz.
6. Show the quiz, result, explanation, and valid timestamp reference in the Side Panel, then retain the learning history.

The MVP supports **YouTube Web only** on Chrome and Microsoft Edge with Manifest V3. It does not classify videos as educational or non-educational, and does not support Udemy, Coursera, a standalone video platform, flashcard export, or advanced personalization.

If a transcript is unavailable or insufficient, the product must not invent content or generate an unsupported quiz. Backend, AI, network, and invalid-output failures must remain non-blocking for YouTube playback and must surface a clear retryable status where appropriate.

---

## 2. System Architecture

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

## 3. Repository Structure

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
│           ├── shared/                # HTTP, messaging, errors, published TS contract projections
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
│       │   └── features/              # question_generation, grading; no video-classification feature
│       ├── requirements.txt
│       └── pyproject.toml
│
├── contracts/                         # Source of truth for API contracts (Baseline 0.3.0)
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

## 4. Module Ownership Matrix

| Feature Module | Developer Owner | Extension Feature | Backend Feature | AI Feature | Contracts |
|---|---|---|---|---|---|
| **Persistent Activation** | **Dev 1** | `features/video-activation/`<br>`platform/youtube/` | `Features/VideoActivation/` integration seam | — | `video-activation.schema.json`<br>`video-activation.yaml` |
| **Session & Quiz** | **Dev 2** | `features/session-quiz/` | `Features/SessionQuiz/` | `features/question_generation/` | `session-quiz.yaml`<br>`question-generation.yaml` |
| **Assessment & History** | **Dev 3** | `features/assessment-history/` | `Features/AssessmentHistory/` | `features/grading/` | `assessment-history.yaml`<br>`grading.yaml` |
| **Tab audio transcription** | **Dev 1 + Integration Captain** | `platform/audio/`, `features/video-activation/` | `Features/VideoActivation/` | `features/transcription/` | `video-activation.yaml`<br>`transcription.yaml` |

### Shared & HOT Files
Developers 1, 2, and 3 must not modify shared HOT files in daily feature tasks. Integration changes are managed by the Integration Captain:
- `AGENTS.md`
- `apps/extension/manifest.json`, `vite.config.ts`, `src/shell/**`, `src/shared/**`
- `services/api/src/StudyLens.Api/Program.cs`, `BuildingBlocks/**`, `StudyLensDbContext.cs`
- `services/ai/app/main.py`, `app/platform/**`
- `contracts/public-api/root.yaml`, `contracts/ai-api/root.yaml`

---

## 5. Environment Prerequisites

- **Node.js**: v18+ (tested with v22.18.0) and `npm`
- **.NET SDK**: .NET 8.0 SDK (tested with 10.0.101 supporting .NET 8)
- **Python**: 3.12+ (tested with 3.13.7)

---

## 6. Local Development Commands

### 6.1 Browser Extension

```powershell
cd apps/extension
npm.cmd install
npm.cmd run build
```

To load unpacked in Chrome or Edge:
1. Navigate to `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `apps/extension/dist`.
4. Open any YouTube video and click the StudyLens side panel icon.

After every source update, run `npm.cmd run build`, then click the reload
button for StudyLens on the Extensions page before refreshing the YouTube tab.
The build verifies that `content-script.js` is a self-contained classic bundle,
which Chrome/Edge can load through the Manifest V3 `content_scripts` entry.

### 6.2 ASP.NET Core Backend

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

### 6.3 FastAPI AI Service

```powershell
cd services/ai
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Run AI service (defaults to http://localhost:8000)
uvicorn app.main:app --reload --port 8000
```

For real tab-audio STT, configure the ignored local `.env` (never the Extension)
before starting FastAPI:

```dotenv
STT_PROVIDER=gemini
GEMINI_TRANSCRIBE_MODEL=gemini-3.5-transcribe
```

`GEMINI_API_KEY` stays only in the local FastAPI environment. Use
`STT_PROVIDER=fake` for deterministic automated tests. Each WebM/Opus chunk is
discarded after transcription; only timestamped cues are retained by the Backend.

**Health endpoint:**
- `GET http://localhost:8000/health` — FastAPI service health check

---

## 7. Persistent Activation Contract Migration

The v1.2 architecture uses contract baseline **0.3.0**. It introduces `ExtensionActivationState`, removes video classification, and uses the explicit `VIDEO_CONTEXT_CHANGED` seam when a supported YouTube SPA page changes while StudyLens remains ON. Dev 1 publishes the transition before capturing the replacement page. If a page is no longer supported it publishes `VIDEO_CONTEXT_UNAVAILABLE` without persisting OFF. Tab audio is the sole runtime transcript source: learner-approved YouTube audio is sent in 30-second WebM/Opus chunks through the Backend to STT, then retained only as timestamped cues. Chrome requires the learner to start tab capture after a browser restart. `TranscriptCaptureRef` plus `PreferenceSnapshot` are the Dev 1 → Dev 2 handoff; a replacement `ACTIVATION_ENABLED` is published only after its first valid STT cue is available. Cross-feature progress and retryable failures use `OPERATION_STATUS_CHANGED`.

Existing `0.1.0` artifacts must be migrated in one explicit Integration Captain task. Do not mix `0.1.0` and `0.3.0` message envelopes or API DTOs in one runtime path. The migration must update contracts, fixtures, producers, consumers, tests, and the corresponding ADR before merge.

## 8. Verification Status

The current checks verify the walking-skeleton communication path:
- Extension builds cleanly and connects to Backend via typed `HttpClient`.
- Backend responds on `/api/health` and queries AI service via `AiHealthClient`.
- FastAPI AI service responds on `/health` and has question-generation, grading and tab-audio transcription routers registered; v1.2 has no classification router. Tab audio is received only as an in-flight chunk and is not persisted.
- All 3 backend module test suites pass.

This is not, by itself, acceptance evidence for every MVP requirement. Product acceptance additionally requires persistent ON/OFF restore, valid/invalid transcript handling, actual watched-time tracking, quiz generation, answer/grading, timestamp review, history, and Chrome/Edge smoke testing.

---

## 9. Codex Vibecode Layout

Repo guidance for Codex is organized by purpose:

```text
AGENTS.md                  # Always-loaded root rules
apps/extension/AGENTS.md   # Extension rules
services/api/AGENTS.md     # Backend rules
services/ai/AGENTS.md      # FastAPI AI rules
contracts/AGENTS.md        # API contract rules

.agents/
├── rules/                 # Shared dev rules and API/module checklists
│   └── dev/               # Detailed Dev 1, Dev 2, Dev 3 role rules
├── playbooks/             # Feature and integration workflows
└── skills/                # Repo skills callable from Codex

.codex/
└── agents/                # Dev 1, Dev 2, Dev 3, Integration Captain profiles
```

Recommended Codex skills:

- `$studylens-vertical-feature` for normal feature work.
- `$studylens-contract-first` before API, DTO, or message-schema changes.
- `$studylens-integration-captain` for shared/HOT file integration work.

Detailed role files:

- `.agents/rules/dev/dev1-persistent-activation.md`
- `.agents/rules/dev/dev2-session-quiz.md`
- `.agents/rules/dev/dev3-assessment-history.md`
