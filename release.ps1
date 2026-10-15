param(
    [ValidateSet('build', 'verify', 'smoke', 'down')]
    [string] $Action = 'verify',
    [ValidateSet('configured', 'fake')]
    [string] $Provider = 'configured',
    [switch] $SkipComposeConfig
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = $PSScriptRoot
$extensionRoot = Join-Path $repoRoot 'apps/extension'
$packageScript = Join-Path $extensionRoot 'scripts/package-extension.ps1'
$apiRoot = Join-Path $repoRoot 'services/api'
$aiRoot = Join-Path $repoRoot 'services/ai'
$aiPython = Join-Path $aiRoot '.venv/Scripts/python.exe'
$vitest = Join-Path $extensionRoot 'node_modules/.bin/vitest.cmd'
$sessionQuizContractRoot = Join-Path $repoRoot 'tests/contract/session-quiz'
$assessmentHistoryContractRoot = Join-Path $repoRoot 'tests/contract/assessment-history'
$composeFile = Join-Path $repoRoot 'deploy/docker-compose.release.yml'
$releaseEnv = Join-Path $repoRoot 'deploy/release.env'
$releaseEnvExample = Join-Path $repoRoot 'deploy/release.env.example'
$rootEnv = Join-Path $repoRoot '.env'

function Invoke-Checked([string] $Command, [string[]] $Arguments, [string] $Directory) {
    Push-Location -LiteralPath $Directory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Command exited with code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
}

function Get-EnvironmentValues([string[]] $Paths) {
    $values = @{}
    foreach ($path in $Paths) {
        foreach ($line in Get-Content -LiteralPath $path) {
            if ($line -match '^\s*#' -or $line -notmatch '^\s*([^=\s]+)\s*=\s*(.*)$') { continue }
            $values[$matches[1]] = $matches[2].Trim()
        }
    }
    return $values
}

function Get-ComposeEnvPaths([switch] $RequireConfigured, [string] $SelectedProvider = 'configured') {
    $selected = if (Test-Path -LiteralPath $releaseEnv) { $releaseEnv } else { $releaseEnvExample }
    if ($RequireConfigured -and $selected -eq $releaseEnvExample) {
        throw 'Create deploy/release.env from deploy/release.env.example before starting the release stack.'
    }

    $paths = @($selected)
    if ($SelectedProvider -eq 'configured' -and (Test-Path -LiteralPath $rootEnv)) {
        # The later env file wins. This keeps the database password in the
        # deployment file while reusing the server-only Gemini configuration.
        $paths += $rootEnv
    }

    if ($RequireConfigured) {
        $values = Get-EnvironmentValues $paths
        if (-not $values.ContainsKey('POSTGRES_PASSWORD') -or
            [string]::IsNullOrWhiteSpace($values['POSTGRES_PASSWORD']) -or
            $values['POSTGRES_PASSWORD'] -like 'CHANGE_ME*') {
            throw 'Replace the placeholder POSTGRES_PASSWORD in deploy/release.env.'
        }
        if ($SelectedProvider -eq 'configured') {
            $effectiveProvider = if ($values.ContainsKey('LLM_PROVIDER') -and
                -not [string]::IsNullOrWhiteSpace($values['LLM_PROVIDER'])) {
                $values['LLM_PROVIDER'].ToLowerInvariant()
            } else {
                'gemini'
            }
            if ($effectiveProvider -ne 'gemini') {
                throw "Configured release mode requires LLM_PROVIDER=gemini, not '$effectiveProvider'. Use -Provider fake only for deterministic E2E testing."
            }
            if (-not $values.ContainsKey('GEMINI_API_KEY') -or [string]::IsNullOrWhiteSpace($values['GEMINI_API_KEY'])) {
                throw 'GEMINI_API_KEY is required for configured release mode.'
            }
        }
    }
    return $paths
}

function Invoke-Compose(
    [string[]] $Arguments,
    [switch] $RequireConfigured,
    [string] $SelectedProvider = 'configured'
) {
    $envPaths = Get-ComposeEnvPaths -RequireConfigured:$RequireConfigured -SelectedProvider $SelectedProvider
    $composeArguments = @('compose')
    foreach ($envPath in $envPaths) {
        $composeArguments += @('--env-file', $envPath)
    }
    $composeArguments += @('-f', $composeFile)

    $previousProvider = [Environment]::GetEnvironmentVariable('LLM_PROVIDER', 'Process')
    try {
        $effectiveProvider = if ($SelectedProvider -eq 'fake') { 'fake' } else { 'gemini' }
        [Environment]::SetEnvironmentVariable('LLM_PROVIDER', $effectiveProvider, 'Process')
        Invoke-Checked 'docker' ($composeArguments + $Arguments) $repoRoot
    } finally {
        [Environment]::SetEnvironmentVariable('LLM_PROVIDER', $previousProvider, 'Process')
    }
}

switch ($Action) {
    'build' {
        & $packageScript
        Invoke-Compose @('build') -SelectedProvider $Provider
        break
    }
    'verify' {
        Invoke-Checked 'npm.cmd' @('test', '--', '--run', '--reporter=basic') $extensionRoot
        Invoke-Checked $vitest @('--run', '--config', 'vitest.config.mjs', '--reporter=basic') $sessionQuizContractRoot
        Invoke-Checked $vitest @('--run', '--config', 'vitest.config.mjs', '--reporter=basic') $assessmentHistoryContractRoot
        Invoke-Checked 'npm.cmd' @('run', 'typecheck') $extensionRoot
        Invoke-Checked 'npm.cmd' @('run', 'build') $extensionRoot
        Invoke-Checked 'dotnet' @('test', 'StudyLens.sln', '--configuration', 'Release') $apiRoot
        if (Test-Path -LiteralPath $aiPython) {
            Invoke-Checked $aiPython @('-m', 'pytest', '-q') $aiRoot
        } else {
            Invoke-Checked 'py' @('-3.12', '-m', 'pytest', '-q') $aiRoot
        }
        & $packageScript -SkipBuild
        & $packageScript -VerifyOnly
        if (-not $SkipComposeConfig) {
            Invoke-Compose @('config', '--quiet') -SelectedProvider $Provider
        }
        break
    }
    'smoke' {
        & $packageScript -VerifyOnly
        Invoke-Compose @('up', '--build', '--detach', '--wait') -RequireConfigured -SelectedProvider $Provider
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/health/ready' -TimeoutSec 10
        if ($health.status -ne 'ready') { throw 'Release API did not report ready.' }
        Write-Host "Release stack is healthy with provider mode '$Provider'. The Extension ZIP is ready for Chrome/Edge sideload smoke testing."
        break
    }
    'down' {
        Invoke-Compose @('down') -SelectedProvider $Provider
        Write-Host 'Release containers stopped; the named PostgreSQL data volume was preserved.'
        break
    }
}
