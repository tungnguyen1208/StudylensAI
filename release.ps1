param(
    [ValidateSet('build', 'verify', 'smoke', 'down')]
    [string] $Action = 'verify'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = $PSScriptRoot
$extensionRoot = Join-Path $repoRoot 'apps/extension'
$packageScript = Join-Path $extensionRoot 'scripts/package-extension.ps1'

function Invoke-Checked([string] $Command, [string[]] $Arguments, [string] $Directory) {
    Push-Location -LiteralPath $Directory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Command exited with code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
}

switch ($Action) {
    'build' {
        & $packageScript
        break
    }
    'verify' {
        Invoke-Checked 'npm.cmd' @('test', '--', '--run', '--reporter=basic') $extensionRoot
        Invoke-Checked 'npm.cmd' @('run', 'typecheck') $extensionRoot
        & $packageScript
        & $packageScript -VerifyOnly
        break
    }
    'smoke' {
        & $packageScript -VerifyOnly
        Write-Host 'Extension release package is ready for Chrome/Edge sideload smoke testing.'
        break
    }
    'down' {
        Write-Host 'No release containers are defined yet; the Extension package does not start background services.'
        break
    }
}
