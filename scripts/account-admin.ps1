param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('assign', 'reset')]
    [string] $Action,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]{3,32}$')]
    [string] $Username,
    [string] $UserId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot 'deploy/docker-compose.release.yml'
$releaseEnv = Join-Path $repoRoot 'deploy/release.env'
$rootEnv = Join-Path $repoRoot '.env'

if (-not (Test-Path -LiteralPath $releaseEnv)) { throw 'deploy/release.env is required.' }
$parsedUserId = [Guid]::Empty
if ($Action -eq 'assign' -and -not [Guid]::TryParse($UserId, [ref]$parsedUserId)) {
    throw '-UserId must be a valid existing StudyLens account ID for assign.'
}

$first = Read-Host 'New password (15-128 characters)' -AsSecureString
$second = Read-Host 'Confirm new password' -AsSecureString
$firstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
$secondPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPointer)
    $confirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPointer)
    if ($plain -cne $confirmation) { throw 'Password confirmation does not match.' }
    if ($plain.Length -lt 15 -or $plain.Length -gt 128) { throw 'Password must contain 15-128 characters.' }

    $composeArguments = @('compose', '--env-file', $releaseEnv)
    if (Test-Path -LiteralPath $rootEnv) { $composeArguments += @('--env-file', $rootEnv) }
    $composeArguments += @('-f', $composeFile, 'run', '--rm', '-T', 'migrate', "--account-admin=$Action", "--username=$Username")
    if ($Action -eq 'assign') { $composeArguments += "--user-id=$UserId" }
    $plain | & docker @composeArguments
    if ($LASTEXITCODE -ne 0) { throw "Account admin command failed with exit code $LASTEXITCODE." }
} finally {
    if ($firstPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPointer) }
    if ($secondPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPointer) }
    $plain = $null
    $confirmation = $null
}
