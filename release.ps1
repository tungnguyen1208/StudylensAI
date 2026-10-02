param(
    [ValidateSet('build', 'verify', 'smoke', 'down')]
    [string] $Action = 'verify'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = $PSScriptRoot
$extensionRoot = Join-Path $repoRoot 'apps/extension'
$packageScript = Join-Path $extensionRoot 'scripts/package-extension.ps1'
$apiRoot = Join-Path $repoRoot 'services/api'
$aiRoot = Join-Path $repoRoot 'services/ai'
$aiPython = Join-Path $aiRoot '.venv/Scripts/python.exe'
$composeFile = Join-Path $repoRoot 'deploy/docker-compose.release.yml'
$releaseEnv = Join-Path $repoRoot 'deploy/release.env'
$releaseEnvExample = Join-Path $repoRoot 'deploy/release.env.example'

function Invoke-Checked([string] $Command, [string[]] $Arguments, [string] $Directory) {
    Push-Location -LiteralPath $Directory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Command exited with code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
}

function Get-ComposeEnv([switch] $RequireConfigured) {
    $selected = if (Test-Path -LiteralPath $releaseEnv) { $releaseEnv } else { $releaseEnvExample }
    if ($RequireConfigured -and $selected -eq $releaseEnvExample) {
        throw 'Create deploy/release.env from deploy/release.env.example before starting the release stack.'
    }
    if ($RequireConfigured) {
        $contents = Get-Content -LiteralPath $selected -Raw
        if ($contents -match 'POSTGRES_PASSWORD=CHANGE_ME') {
            throw 'Replace the placeholder POSTGRES_PASSWORD in deploy/release.env.'
        }
        if ($contents -match '(?m)^LLM_PROVIDER=gemini\s*$' -and $contents -match '(?m)^GEMINI_API_KEY=\s*$') {
            throw 'GEMINI_API_KEY is required when LLM_PROVIDER=gemini.'
        }
    }
    return $selected
}

function Invoke-Compose([string[]] $Arguments, [switch] $RequireConfigured) {
    $envPath = Get-ComposeEnv -RequireConfigured:$RequireConfigured
    Invoke-Checked 'docker' (@('compose', '--env-file', $envPath, '-f', $composeFile) + $Arguments) $repoRoot
}

switch ($Action) {
    'build' {
        & $packageScript
        Invoke-Compose @('build')
        break
    }
    'verify' {
        Invoke-Checked 'npm.cmd' @('test', '--', '--run', '--reporter=basic') $extensionRoot
        Invoke-Checked 'npm.cmd' @('run', 'typecheck') $extensionRoot
        Invoke-Checked 'dotnet' @('test', 'StudyLens.sln', '--configuration', 'Release') $apiRoot
        if (Test-Path -LiteralPath $aiPython) {
            Invoke-Checked $aiPython @('-m', 'pytest', '-q') $aiRoot
        } else {
            Invoke-Checked 'py' @('-3.12', '-m', 'pytest', '-q') $aiRoot
        }
        & $packageScript
        & $packageScript -VerifyOnly
        Invoke-Compose @('config', '--quiet')
        break
    }
    'smoke' {
        & $packageScript -VerifyOnly
        Invoke-Compose @('up', '--build', '--detach', '--wait') -RequireConfigured
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/health/ready' -TimeoutSec 10
        if ($health.status -ne 'ready') { throw 'Release API did not report ready.' }
        Write-Host 'Release stack is healthy. The Extension ZIP is ready for Chrome/Edge sideload smoke testing.'
        break
    }
    'down' {
        Invoke-Compose @('down')
        Write-Host 'Release containers stopped; the named PostgreSQL data volume was preserved.'
        break
    }
}
