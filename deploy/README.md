# StudyLens Deployment Configurations

## Release stack

The release stack keeps PostgreSQL and FastAPI private on the Docker network;
only ASP.NET Core is published on `127.0.0.1:5000`. Copy the release template,
set a long random database password, and choose `fake` for deterministic smoke
tests or `gemini` plus a server-side API key for provider acceptance:

```powershell
Copy-Item deploy/release.env.example deploy/release.env
notepad deploy/release.env
.\release.ps1 build
.\release.ps1 smoke
.\release.ps1 down
```

`migrate` must finish successfully before `api` starts. Production API startup
does not migrate implicitly. Both application images run as non-root users,
base images are digest-pinned, Python dependencies are exact-pinned, and the
ignored `deploy/release.env` is never copied into an image or Extension bundle.
`down` preserves the named PostgreSQL volume.

Operational probes:

- `GET /api/health/live` checks the API process.
- `GET /api/health/ready` requires both PostgreSQL and FastAPI.
- `GET /api/health` remains the Extension-compatible health endpoint.

For a controlled migration test, the migration-only process also accepts an
optional target, for example
`--migrate-only --migrate-to=20261001090000_AddPostgresQuizMetadata`. Normal
release deployment omits the target and migrates to the latest version.

`docker-compose.postgres.yml` starts the development PostgreSQL dependency.
Copy `postgres.env.example` to the ignored `postgres.env`, replace the sample
password, then run:

```powershell
docker compose --env-file deploy/postgres.env -f deploy/docker-compose.postgres.yml up -d
```

The Backend reads its connection from `ConnectionStrings__DefaultConnection`.
PostgreSQL is the runtime database; existing SQLite files are legacy/export
artifacts and must not be pointed to by the PostgreSQL connection setting.

## One-command local development (Windows PowerShell)

From the repository root, after installing Extension dependencies and the AI
virtual environment once:

```powershell
.\dev.ps1 validate  # prerequisites and Compose config; starts nothing
.\dev.ps1 up        # PostgreSQL, Backend watch, AI reload, Extension full-build watch
.\dev.ps1 check     # Extension tests/build, Backend tests, AI tests with fake provider
.\dev.ps1 down      # stop PostgreSQL without deleting its data volume
```

Keep the `up` terminal open. Press Ctrl+C to stop the three foreground watchers;
PostgreSQL remains available until `down`. The script reads the ignored
`deploy/postgres.env` and constructs the Backend connection string in memory.
It does not print or copy that password or the Gemini key into the Extension.
Saving Extension source rebuilds all three bundles, including the content
script. Chrome/Edge still requires reloading the unpacked Extension; refresh
the YouTube tab after a content-script change.

For a Command Prompt (`cmd`) terminal, use `dev.cmd up`, `dev.cmd check`, or
`dev.cmd down` instead. Docker Desktop must show **Engine running** before
`up` or `validate`; installing the Docker CLI alone is not sufficient. `up`
also requires ports 5000 (Backend) and 8000 (AI Service) to be free; stop
previously launched development servers before starting another instance.
