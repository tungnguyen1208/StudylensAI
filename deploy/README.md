# StudyLens Deployment Configurations

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
