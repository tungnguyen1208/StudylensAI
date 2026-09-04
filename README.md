# StudyLens AI

StudyLens AI is a Chrome/Edge browser extension that helps users learn actively from YouTube Web videos.

This repository currently contains the base walking skeleton for the MVP:

```text
Chrome/Edge Extension
    -> ASP.NET Core Backend
    -> FastAPI AI Service
```

No full StudyLens business feature is implemented yet.

## Repository Layout

```text
apps/
  extension/       Chrome/Edge Manifest V3 extension built with React, TypeScript, and Vite
services/
  api/             ASP.NET Core Web API with Swagger, EF Core, SQLite config, and AI service client
  ai-service/      FastAPI application with a health endpoint and future LLM abstraction
docs/
  api-contracts/   Integration contracts
  architecture/    Architecture notes
scripts/           Future project scripts
docker/            Future local container helpers
```

Detailed file and folder responsibilities are documented in `docs/architecture/repository-map.md`.

## Extension

```powershell
cd apps\extension
npm.cmd install
npm.cmd run dev
npm.cmd run build
```

To load the extension:

1. Build the extension with `npm.cmd run build`.
2. Open Chrome or Edge extension management.
3. Enable developer mode.
4. Load unpacked from `apps\extension\dist`.

The extension reads the backend URL from `VITE_BACKEND_URL`. If it is not set, it uses `http://localhost:5000`.

## ASP.NET Core Backend

```powershell
cd services\api
dotnet restore
dotnet run
```

Default health endpoint:

```text
GET http://localhost:5000/api/health
```

AI-service health proxy:

```text
GET http://localhost:5000/api/health/ai-service
```

Swagger is available in development:

```text
http://localhost:5000/swagger
```

The backend reads `AIService:BaseUrl` from `appsettings.json` or `AI_SERVICE_URL` from environment variables. SQLite uses `ConnectionStrings:StudyLens` or `DATABASE_CONNECTION`.

## FastAPI AI Service

```powershell
cd services\ai-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Default health endpoint:

```text
GET http://localhost:8000/health
```

## Current Status

The walking skeleton proves the local path:

```text
Extension
    -> ASP.NET Core Backend
    -> FastAPI AI Service
```

Next recommended feature after this foundation is M1 Video & Activation.
