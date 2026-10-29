param(
    [string] $BaseUrl = 'http://127.0.0.1:5000',
    [ValidatePattern('^[A-Za-z0-9_-]{11}$')]
    [string] $VideoId = 'RD53wLkH3mQ',
    [string] $VideoTitle = 'StudyLens release E2E lesson',
    [ValidateSet('multipleChoice', 'shortAnswer')]
    [string] $QuestionType = 'multipleChoice',
    [ValidateSet('easy', 'medium', 'hard')]
    [string] $Difficulty = 'medium',
    [ValidateSet('available', 'unavailable', 'insufficient')]
    [string] $TranscriptStatus = 'available',
    [long] $DurationMs = 540000,
    [int] $TimeoutSeconds = 360,
    [string] $AccessToken = $env:STUDYLENS_E2E_ACCESS_TOKEN,
    [switch] $SeedLocalAccount,
    [switch] $SkipAttempt
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function ConvertTo-Base64Url {
    param([byte[]] $Bytes)
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-Sha256Hex {
    param([string] $Value)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Value))
        return -join ($bytes | ForEach-Object { $_.ToString('x2') })
    } finally {
        $sha.Dispose()
    }
}

function New-LocalE2eAccount {
    $containerId = (& docker ps --filter 'label=com.docker.compose.project=studylens-release' --filter 'label=com.docker.compose.service=postgres' --format '{{.ID}}').Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) {
        throw 'The StudyLens release PostgreSQL container is not running. Start it with .\release.ps1 smoke -Provider fake.'
    }

    $postgresUser = (& docker exec $containerId printenv POSTGRES_USER).Trim()
    $postgresDatabase = (& docker exec $containerId printenv POSTGRES_DB).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($postgresUser) -or [string]::IsNullOrWhiteSpace($postgresDatabase)) {
        throw 'Could not read the PostgreSQL connection identity from the release container.'
    }

    $tokenBytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($tokenBytes)
    } finally {
        $random.Dispose()
    }
    $rawToken = ConvertTo-Base64Url $tokenBytes
    $tokenHash = Get-Sha256Hex $rawToken
    $suffix = [guid]::NewGuid().ToString('N')
    $userId = "e2e-$suffix"
    $username = "e2e-$($suffix.Substring(0, 20))"
    if ($username.Length -gt 32 -or $username -notmatch '^[A-Za-z0-9._-]{3,32}$') {
        throw 'The generated E2E username does not satisfy the public account contract.'
    }
    $now = [DateTimeOffset]::UtcNow
    $nowText = $now.ToString('O')
    $expiresText = $now.AddMinutes(15).ToString('O')
    $sql = @"
BEGIN;
INSERT INTO "AppUsers" ("UserId", "GoogleSubject", "Email", "DisplayName", "PictureUrl", "CreatedAtUtc", "LastLoginAtUtc")
VALUES ('$userId', NULL, NULL, 'Release E2E', NULL, '$nowText', '$nowText');
INSERT INTO "LocalCredentials" ("UserId", "Username", "NormalizedUsername", "PasswordHash", "FailedAccessAttempts", "LockoutEndUtc", "PasswordChangedAtUtc")
VALUES ('$userId', '$username', '$($username.ToUpperInvariant())', 'e2e-seed-does-not-support-password-login', 0, NULL, '$nowText');
INSERT INTO "AuthTokens" ("TokenHash", "UserId", "TokenType", "CreatedAtUtc", "ExpiresAtUtc", "RevokedAtUtc")
VALUES ('$tokenHash', '$userId', 'access', '$nowText', '$expiresText', NULL);
COMMIT;
"@

    $sql | & docker exec -i $containerId psql --username $postgresUser --dbname $postgresDatabase --set ON_ERROR_STOP=1 --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Could not seed the local E2E account.' }

    return [pscustomobject]@{ UserId = $userId; AccessToken = $rawToken }
}

function Invoke-JsonRequest {
    param(
        [ValidateSet('GET', 'POST', 'PUT')]
        [string] $Method,
        [string] $Uri,
        [object] $Body
    )

    $parameters = @{
        Method = $Method
        Uri = $Uri
        TimeoutSec = 60
        Headers = $script:authHeaders
    }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json; charset=utf-8'
        $json = $Body | ConvertTo-Json -Depth 20 -Compress
        $parameters.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    }
    Invoke-RestMethod @parameters
}

function Get-CanonicalHash {
    param([object[]] $Cues)

    $lines = $Cues |
        Sort-Object @{ Expression = { [long] $_.startMs } }, @{ Expression = { [long] $_.endMs } } |
        ForEach-Object {
            $text = [regex]::Replace([string] $_.text, '\s+', ' ').Trim()
            if ($text.Length -gt 0) { '{0}|{1}|{2}' -f $_.startMs, $_.endMs, $text }
        }
    $canonical = $lines -join "`n"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonical))
        return -join ($bytes | ForEach-Object { $_.ToString('x2') })
    } finally {
        $sha.Dispose()
    }
}

function Get-ExpectedQuestionCount {
    param([long] $Duration)
    if ($Duration -lt 600000) { return 3 }
    if ($Duration -lt 1800000) { return 5 }
    if ($Duration -lt 3600000) { return 10 }
    return 15
}

if ($SeedLocalAccount) {
    if (-not [string]::IsNullOrWhiteSpace($AccessToken)) {
        throw 'Use either -SeedLocalAccount or -AccessToken/STUDYLENS_E2E_ACCESS_TOKEN, not both.'
    }
    $seededAccount = New-LocalE2eAccount
    $AccessToken = $seededAccount.AccessToken
    Write-Host "Seeded local E2E account $($seededAccount.UserId)."
}
if ([string]::IsNullOrWhiteSpace($AccessToken)) {
    throw 'Authentication is required. Use -SeedLocalAccount for the local fake stack, or set STUDYLENS_E2E_ACCESS_TOKEN to a valid StudyLens access token.'
}
$script:authHeaders = @{ Authorization = "Bearer $AccessToken" }

$runId = [guid]::NewGuid()
$activationId = [guid]::NewGuid()
$session = Invoke-JsonRequest POST "$BaseUrl/api/sessions" @{
    contractVersion = '0.7.0'
    activationId = $activationId
    idempotencyKey = "release-e2e:session:$runId"
    youtubeVideoId = $VideoId
    videoTitle = $VideoTitle
    preferences = @{
        questionType = $QuestionType
        difficulty = $Difficulty
    }
}

$cues = @()
if ($TranscriptStatus -eq 'available') {
    $topics = @(
        'Binary search requires a sorted collection before the search begins.',
        'The algorithm compares the target with the middle element of the remaining range.',
        'If the target is smaller, the algorithm continues in the left half.',
        'If the target is larger, the algorithm continues in the right half.',
        'Each comparison removes half of the remaining candidates.',
        'This repeated halving gives binary search logarithmic time complexity.',
        'An unsuccessful search ends when the lower bound passes the upper bound.',
        'The evidence timestamp lets the learner return to the exact explanation in the video.'
    )
    for ($index = 0; $index -lt $topics.Count; $index++) {
        $start = [long] [math]::Floor($DurationMs * $index / $topics.Count)
        $end = if ($index -eq $topics.Count - 1) { $DurationMs } else { [long] [math]::Floor($DurationMs * ($index + 1) / $topics.Count) }
        $cues += @{ startMs = $start; endMs = $end; text = $topics[$index] }
    }
}

$transcriptBody = @{
    contractVersion = '0.7.0'
    idempotencyKey = "release-e2e:transcript:$runId"
    youtubeVideoId = $VideoId
    language = 'en'
    source = 'youtubeCaption'
    status = $TranscriptStatus
    durationMs = $DurationMs
    cues = $cues
}
if ($TranscriptStatus -eq 'available') {
    $transcriptBody.contentHash = Get-CanonicalHash $cues
}

$null = Invoke-JsonRequest PUT "$BaseUrl/api/sessions/$($session.sessionId)/transcript" $transcriptBody

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
    Start-Sleep -Seconds 2
    $package = Invoke-JsonRequest GET "$BaseUrl/api/sessions/$($session.sessionId)/learning-package" $null
    if ($package.quizStatus -eq 'failed' -or $package.transcript.status -eq 'failed' -or $package.transcript.status -eq 'unavailable') {
        $errorCode = if ($null -ne $package.error) { $package.error.code } else { 'unknownProcessingFailure' }
        throw "Learning package failed: $errorCode"
    }
} while ($package.quizStatus -ne 'ready' -and (Get-Date) -lt $deadline)

if ($package.quizStatus -ne 'ready') {
    throw "Quiz was not ready after $TimeoutSeconds seconds."
}

$questions = @($package.quiz.questions)
if ($questions.Count -lt 1) { throw 'The ready quiz is empty.' }
$expectedCount = Get-ExpectedQuestionCount $DurationMs
if ($questions.Count -gt $expectedCount) { throw "Quiz contains $($questions.Count) questions; target is $expectedCount." }

$normalizedPrompts = @($questions | ForEach-Object { ([regex]::Replace($_.prompt.Trim().ToLowerInvariant(), '\s+', ' ')) })
if (@($normalizedPrompts | Select-Object -Unique).Count -ne $normalizedPrompts.Count) {
    throw 'Quiz contains duplicate prompts.'
}
foreach ($question in $questions) {
    if ($question.source.youtubeVideoId -ne $VideoId) { throw 'Question evidence points to another video.' }
    if ($question.source.startMs -lt 0 -or $question.source.endMs -le $question.source.startMs -or $question.source.endMs -gt $DurationMs) {
        throw 'Question evidence timestamp is outside the video duration.'
    }
    if ($question.PSObject.Properties.Name -contains 'correctOptionId' -or $question.PSObject.Properties.Name -contains 'referenceAnswer') {
        throw 'The public quiz leaked a correct answer before submission.'
    }
}

$attempt = $null
if (-not $SkipAttempt) {
    $answers = @($questions | ForEach-Object {
        if ($_.type -eq 'multipleChoice') {
            @{ questionId = $_.questionId; selectedOptionId = @($_.options)[0].optionId }
        } else {
            @{ questionId = $_.questionId; answerText = 'Binary search repeatedly halves a sorted search range using comparisons with the middle element.' }
        }
    })
    $clientAttemptId = [guid]::NewGuid()
    $attemptBody = @{ contractVersion = '0.7.0'; clientAttemptId = $clientAttemptId; answers = $answers }
    $attempt = Invoke-JsonRequest POST "$BaseUrl/api/quizzes/$($package.quiz.quizId)/attempts" $attemptBody
    $attemptReplay = Invoke-JsonRequest POST "$BaseUrl/api/quizzes/$($package.quiz.quizId)/attempts" $attemptBody
    if ($attemptReplay.quizAttemptId -ne $attempt.quizAttemptId) { throw 'Attempt replay was not idempotent.' }
}

$history = Invoke-JsonRequest GET "$BaseUrl/api/history/videos/$VideoId" $null
if ($null -ne $attempt) {
    $attemptHistory = @($history.items | Where-Object { $_.quizAttemptId -eq $attempt.quizAttemptId })
    if ($attemptHistory.Count -ne $questions.Count) { throw 'History does not contain the full submitted attempt.' }
    if (@($attemptHistory | Where-Object { $_.youtubeVideoId -ne $VideoId -or $_.sessionId -ne $session.sessionId }).Count -ne 0) {
        throw 'History is linked to the wrong video or session.'
    }
}

[pscustomobject]@{
    sessionId = $session.sessionId
    videoId = $VideoId
    transcriptSource = $package.transcript.source
    transcriptStatus = $package.transcript.status
    quizId = $package.quiz.quizId
    quizStatus = $package.quizStatus
    targetQuestionCount = $expectedCount
    actualQuestionCount = $questions.Count
    quizAttemptId = if ($null -ne $attempt) { $attempt.quizAttemptId } else { $null }
    attemptScore = if ($null -ne $attempt) { $attempt.score } else { $null }
    historyRowsForAttempt = if ($null -ne $attempt) { @($history.items | Where-Object { $_.quizAttemptId -eq $attempt.quizAttemptId }).Count } else { 0 }
} | ConvertTo-Json -Depth 10
