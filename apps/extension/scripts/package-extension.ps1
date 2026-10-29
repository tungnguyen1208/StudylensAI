param(
    [switch] $SkipBuild,
    [switch] $VerifyOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$extensionRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $extensionRoot)
$distRoot = Join-Path $extensionRoot 'dist'
$releaseRoot = Join-Path $repoRoot 'artifacts/release'
$stagingRoot = Join-Path $releaseRoot '.extension-staging'
$verifyRoot = Join-Path $releaseRoot '.extension-verify'
$packageJson = Get-Content -LiteralPath (Join-Path $extensionRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string] $packageJson.version
$archiveName = "StudyLens-AI-extension-$version.zip"
$archivePath = Join-Path $releaseRoot $archiveName
$checksumPath = Join-Path $releaseRoot 'SHA256SUMS.txt'
$extensionId = 'pamlknppggagbabbonlighcagfjemdcp'

function Assert-ReleaseChild([string] $Path) {
    $releaseFull = [IO.Path]::GetFullPath($releaseRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $targetFull = [IO.Path]::GetFullPath($Path)
    if (-not $targetFull.StartsWith($releaseFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the release directory: $targetFull"
    }
}

function Reset-Directory([string] $Path) {
    Assert-ReleaseChild $Path
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Test-Package([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Extension archive was not found: $Path" }
    Reset-Directory $verifyRoot
    Expand-Archive -LiteralPath $Path -DestinationPath $verifyRoot -Force

    $required = @('manifest.json', 'sidepanel.html', 'service-worker.js', 'content-script.js', 'release-manifest.json')
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $verifyRoot $relative))) {
            throw "Release archive is missing $relative"
        }
    }

    $forbidden = Get-ChildItem -LiteralPath $verifyRoot -Recurse -File | Where-Object {
        $_.Name -match '^\.env($|\.)|\.map$|\.(ts|tsx)$' -or
        $_.FullName -match '[\\/](node_modules|__tests__|fixtures?)[\\/]'
    }
    if ($forbidden) { throw "Release archive contains forbidden files: $($forbidden.FullName -join ', ')" }

    $manifest = Get-Content -LiteralPath (Join-Path $verifyRoot 'manifest.json') -Raw | ConvertFrom-Json
    if ([string] $manifest.version -ne $version) { throw 'Manifest and package versions do not match.' }
    if (-not $manifest.key) { throw 'Release manifest does not contain the stable public extension key.' }
    if ($manifest.host_permissions -notcontains 'http://localhost:5000/*') { throw 'Backend host permission is missing.' }

    $metadata = Get-Content -LiteralPath (Join-Path $verifyRoot 'release-manifest.json') -Raw | ConvertFrom-Json
    if ($metadata.contractVersion -ne '0.7.0' -or $metadata.extensionId -ne $extensionId) {
        throw 'Release metadata does not match contract 0.7.0 or the stable extension ID.'
    }
    $currentCommitSha = (& git -C $repoRoot rev-parse HEAD).Trim()
    if ([string] $metadata.commitSha -ne $currentCommitSha) {
        throw "Release archive commitSha '$($metadata.commitSha)' does not match HEAD '$currentCommitSha'. Rebuild the package."
    }
}

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

if ($VerifyOnly) {
    Test-Package $archivePath
    $expectedLine = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expectedLine -ne "$actualHash  $archiveName") { throw 'SHA256SUMS.txt does not match the release archive.' }
    Write-Host "Verified $archiveName ($actualHash)"
    exit 0
}

if (-not $SkipBuild) {
    & npm.cmd run build --prefix $extensionRoot
    if ($LASTEXITCODE -ne 0) { throw "Extension build failed with exit code $LASTEXITCODE." }
}
if (-not (Test-Path -LiteralPath $distRoot)) { throw 'Extension dist directory is missing.' }

Reset-Directory $stagingRoot
Copy-Item -Path (Join-Path $distRoot '*') -Destination $stagingRoot -Recurse -Force

$contractText = Get-Content -LiteralPath (Join-Path $repoRoot 'contracts/public-api/root.yaml') -Raw
$contractVersion = [regex]::Match($contractText, '(?m)^\s*version:\s*([0-9.]+)\s*$').Groups[1].Value
if ($contractVersion -ne '0.7.0') { throw "Unexpected public contract version: $contractVersion" }
$commitSha = (& git -C $repoRoot rev-parse HEAD).Trim()
$commitTime = (& git -C $repoRoot show -s --format=%cI HEAD).Trim()
@{
    product = 'StudyLens AI Extension'
    version = $version
    contractVersion = $contractVersion
    extensionId = $extensionId
    commitSha = $commitSha
    commitTimestampUtc = $commitTime
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stagingRoot 'release-manifest.json') -Encoding UTF8

$stableTimestamp = [DateTime]::SpecifyKind([DateTime]'2026-01-01T00:00:00', [DateTimeKind]::Utc)
Get-ChildItem -LiteralPath $stagingRoot -Recurse -Force | ForEach-Object { $_.LastWriteTimeUtc = $stableTimestamp }

Assert-ReleaseChild $archivePath
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
Push-Location -LiteralPath $stagingRoot
try {
    $items = Get-ChildItem -Force | Sort-Object Name | Select-Object -ExpandProperty FullName
    Compress-Archive -Path $items -DestinationPath $archivePath -CompressionLevel Optimal
} finally {
    Pop-Location
}

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath $checksumPath -Value "$hash  $archiveName" -Encoding ASCII
Test-Package $archivePath
Write-Host "Packaged $archivePath"
Write-Host "SHA256 $hash"
