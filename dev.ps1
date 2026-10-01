param(
    [ValidateSet('up', 'check', 'down', 'validate')]
    [string] $Action = 'up'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = $PSScriptRoot
$postgresEnvFile = Join-Path $repoRoot 'deploy/postgres.env'
$composeFile = Join-Path $repoRoot 'deploy/docker-compose.postgres.yml'
$aiPython = Join-Path $repoRoot 'services/ai/.venv/Scripts/python.exe'
$extensionDir = Join-Path $repoRoot 'apps/extension'
$vitest = Join-Path $extensionDir 'node_modules/.bin/vitest.cmd'

function Require-Command([string] $Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing command: $Name. Install it before running dev.ps1."
    }
}

function Invoke-Checked([string] $Command, [string[]] $Arguments, [string] $Directory) {
    Push-Location -LiteralPath $Directory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Command exited with code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Read-PostgresSettings {
    if (-not (Test-Path -LiteralPath $postgresEnvFile)) {
        throw 'Missing deploy/postgres.env. Copy deploy/postgres.env.example, then set a private password.'
    }

    $settings = @{}
    foreach ($line in Get-Content -LiteralPath $postgresEnvFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            throw 'deploy/postgres.env contains an invalid assignment.'
        }
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
             ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $settings[$Matches[1]] = $value
    }

    foreach ($key in @('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_PORT')) {
        if (-not $settings.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($settings[$key])) {
            throw "Missing $key in deploy/postgres.env."
        }
    }
    $port = 0
    if (-not [int]::TryParse($settings['POSTGRES_PORT'], [ref] $port) -or $port -lt 1 -or $port -gt 65535) {
        throw 'POSTGRES_PORT must be between 1 and 65535.'
    }
    return $settings
}

function Get-ComposeArguments([string[]] $CommandArguments) {
    return @('compose', '--env-file', $postgresEnvFile, '-f', $composeFile) + $CommandArguments
}

function Assert-DevelopmentTools {
    Require-Command 'docker'
    Require-Command 'dotnet'
    Require-Command 'node'
    Require-Command 'npm.cmd'
    if (-not (Test-Path -LiteralPath $aiPython)) {
        throw 'Missing services/ai/.venv/Scripts/python.exe. Create the AI virtual environment first.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $extensionDir 'node_modules'))) {
        throw 'Missing apps/extension/node_modules. Run npm.cmd install in apps/extension first.'
    }
}

function Assert-DockerEngine {
    try {
        $null = & docker info --format '{{.ServerVersion}}' 2>$null
    }
    catch {
        throw 'Docker Engine is unavailable. Start Docker Desktop and wait for "Engine running", then rerun this command.'
    }
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Engine is unavailable. Start Docker Desktop and wait for "Engine running", then rerun this command.'
    }
}

function Assert-DevelopmentPorts {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 5000,8000 -ErrorAction SilentlyContinue |
        Sort-Object -Property LocalPort,OwningProcess -Unique)
    if ($listeners.Count -gt 0) {
        $details = ($listeners | ForEach-Object { "$($_.LocalPort) (PID $($_.OwningProcess))" }) -join ', '
        throw "Development ports are already in use: $details. Stop the existing Backend/AI Service terminals before running dev.cmd up. No existing process was stopped."
    }
}

try {
switch ($Action) {
    'check' {
        Require-Command 'dotnet'
        Require-Command 'npm.cmd'
        if (-not (Test-Path -LiteralPath $aiPython)) {
            throw 'Missing AI virtual environment. See services/ai/README.md.'
        }
        Invoke-Checked 'npm.cmd' @('test') $extensionDir
        Invoke-Checked 'npm.cmd' @('run', 'test:watch') $extensionDir
        Invoke-Checked 'npm.cmd' @('run', 'typecheck') $extensionDir
        Invoke-Checked 'npm.cmd' @('run', 'build') $extensionDir
        Invoke-Checked $vitest @('run', '--config', 'tests/contract/session-quiz/vitest.config.mjs') $repoRoot
        Invoke-Checked $vitest @('run', '--config', 'tests/contract/assessment-history/vitest.config.mjs') $repoRoot
        Invoke-Checked 'dotnet' @('test', 'services/api/StudyLens.sln', '-c', 'Release') $repoRoot
        $previousProvider = [Environment]::GetEnvironmentVariable('LLM_PROVIDER', 'Process')
        try {
            [Environment]::SetEnvironmentVariable('LLM_PROVIDER', 'fake', 'Process')
            Invoke-Checked $aiPython @('-m', 'pytest', 'app', '-q', '-p', 'no:cacheprovider') (Join-Path $repoRoot 'services/ai')
        }
        finally {
            [Environment]::SetEnvironmentVariable('LLM_PROVIDER', $previousProvider, 'Process')
        }
        Write-Host 'All local checks passed.'
        break
    }
    'validate' {
        Assert-DevelopmentTools
        $null = Read-PostgresSettings
        Assert-DockerEngine
        Invoke-Checked 'docker' (Get-ComposeArguments @('config', '--quiet')) $repoRoot
        Invoke-Checked 'node' @('--check', 'scripts/dev-runner.mjs') $repoRoot
        Invoke-Checked 'node' @('--check', 'scripts/watch-extension.mjs') $extensionDir
        Write-Host 'Development prerequisites and PostgreSQL Compose configuration are valid.'
        break
    }
    'down' {
        Require-Command 'docker'
        $null = Read-PostgresSettings
        Assert-DockerEngine
        Write-Host 'Stop the foreground dev.ps1 up terminal with Ctrl+C before stopping PostgreSQL.'
        Invoke-Checked 'docker' (Get-ComposeArguments @('down')) $repoRoot
        Write-Host 'PostgreSQL stopped; its named data volume was preserved.'
        break
    }
    'up' {
        Assert-DevelopmentTools
        $postgres = Read-PostgresSettings
        Assert-DockerEngine
        Invoke-Checked 'docker' (Get-ComposeArguments @('config', '--quiet')) $repoRoot
        Assert-DevelopmentPorts

        $connection = New-Object System.Data.Common.DbConnectionStringBuilder
        $connection['Host'] = '127.0.0.1'
        $connection['Port'] = [int] $postgres['POSTGRES_PORT']
        $connection['Database'] = $postgres['POSTGRES_DB']
        $connection['Username'] = $postgres['POSTGRES_USER']
        $connection['Password'] = $postgres['POSTGRES_PASSWORD']
        $previousConnection = [Environment]::GetEnvironmentVariable('ConnectionStrings__DefaultConnection', 'Process')
        try {
            Invoke-Checked 'docker' (Get-ComposeArguments @('up', '-d', '--wait', '--wait-timeout', '90')) $repoRoot
            [Environment]::SetEnvironmentVariable('ConnectionStrings__DefaultConnection', $connection.ConnectionString, 'Process')
            Write-Host 'PostgreSQL is ready. Starting Backend, AI Service, and Extension build watcher.'
            Write-Host 'Press Ctrl+C to stop the three watchers. PostgreSQL remains running until dev.ps1 down.'
            Invoke-Checked 'node' @('scripts/dev-runner.mjs') $repoRoot
        }
        finally {
            [Environment]::SetEnvironmentVariable('ConnectionStrings__DefaultConnection', $previousConnection, 'Process')
        }
        break
    }
}
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
