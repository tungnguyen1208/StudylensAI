param(
    [Parameter(Mandatory)]
    [string] $InputPath,
    [Parameter(Mandatory)]
    [string] $OutputPdf,
    [switch] $UpdateSource
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$input = (Resolve-Path -LiteralPath $InputPath).Path
$output = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPdf))
$qaRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'artifacts/docx-qa'))

if (-not $output.StartsWith($qaRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Output must stay under $qaRoot."
}

New-Item -ItemType Directory -Force -Path (Split-Path $output) | Out-Null
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $document = $word.Documents.Open($input, $false, -not $UpdateSource)
    try {
        $document.Fields.Update() | Out-Null
        if ($UpdateSource) {
            $document.Save()
        }
        $document.SaveAs2($output, 17)
    } finally {
        $document.Close($false)
    }
} finally {
    $word.Quit()
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
}

Write-Host "Rendered $input to $output"
