using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Features.VideoActivation.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;

namespace StudyLens.Api.Features.SessionQuiz.Application;

public sealed partial class LearningPackageService(StudyLensDbContext db)
{
    public const string ContractVersion = "0.5.0";

    public async Task<LearningPackageResult> StartAsync(StartLearningSessionCommand command, CancellationToken cancellationToken)
    {
        if (!ValidStart(command))
            return LearningPackageResult.Invalid("invalidSessionRequest", "A valid 0.5.0 session request is required.");

        var existing = await db.Set<StudySessionEntity>()
            .SingleOrDefaultAsync(item => item.StartIdempotencyKey == command.IdempotencyKey, cancellationToken);
        if (existing is not null)
            return SameStart(existing, command)
                ? LearningPackageResult.Success(await BuildPackageAsync(existing, cancellationToken))
                : LearningPackageResult.Conflict();

        var activationSession = await db.Set<StudySessionEntity>()
            .SingleOrDefaultAsync(item => item.ActivationId == command.ActivationId, cancellationToken);
        if (activationSession is not null)
            return SameStart(activationSession, command)
                ? LearningPackageResult.Success(await BuildPackageAsync(activationSession, cancellationToken))
                : LearningPackageResult.Conflict();

        var now = DateTimeOffset.UtcNow;
        var video = await db.Set<StudyVideoEntity>().SingleOrDefaultAsync(item => item.YoutubeVideoId == command.YoutubeVideoId, cancellationToken);
        if (video is null)
        {
            video = new StudyVideoEntity
            {
                YoutubeVideoId = command.YoutubeVideoId,
                Title = command.VideoTitle.Trim(),
                CreatedAtUtc = now,
                LastSeenAtUtc = now,
            };
            db.Add(video);
        }
        else
        {
            video.Title = command.VideoTitle.Trim();
            video.LastSeenAtUtc = now;
        }

        var session = new StudySessionEntity
        {
            SessionId = Guid.NewGuid().ToString(),
            ActivationId = command.ActivationId,
            StartIdempotencyKey = command.IdempotencyKey,
            YoutubeVideoId = command.YoutubeVideoId,
            VideoTitle = command.VideoTitle.Trim(),
            QuestionType = command.QuestionType,
            Difficulty = command.Difficulty,
            Status = "active",
            TranscriptStatus = "waiting",
            QuizStatus = "notStarted",
            StartedAtUtc = now,
        };
        db.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        return LearningPackageResult.Success(await BuildPackageAsync(session, cancellationToken));
    }

    public async Task<LearningPackageResult> SubmitTranscriptAsync(string sessionId, SubmitFullTranscriptCommand command, CancellationToken cancellationToken)
    {
        var session = await db.Set<StudySessionEntity>().SingleOrDefaultAsync(item => item.SessionId == sessionId, cancellationToken);
        if (session is null) return LearningPackageResult.NotFound("sessionNotFound", "The study session was not found.");
        if (!ValidTranscriptEnvelope(session, command))
            return LearningPackageResult.Invalid("invalidTranscript", "The transcript does not match this active session.");

        var normalized = NormalizeCues(command.Cues);
        var fingerprint = Fingerprint(command, normalized);
        if (!string.IsNullOrWhiteSpace(session.TranscriptSubmissionKey))
        {
            return session.TranscriptSubmissionKey == command.IdempotencyKey && session.TranscriptSubmissionFingerprint == fingerprint
                ? LearningPackageResult.Success(await BuildPackageAsync(session, cancellationToken))
                : LearningPackageResult.Conflict();
        }

        session.TranscriptSubmissionKey = command.IdempotencyKey;
        session.TranscriptSubmissionFingerprint = fingerprint;
        ClearError(session);

        if (command.Status == "available")
        {
            if (!ValidCues(normalized))
                return LearningPackageResult.Invalid("invalidTranscriptCues", "Caption cues must contain valid timestamps and text.");
            var contentHash = HashCues(normalized);
            if (!string.IsNullOrWhiteSpace(command.ContentHash) && !string.Equals(contentHash, command.ContentHash, StringComparison.OrdinalIgnoreCase))
                return LearningPackageResult.Invalid("transcriptHashMismatch", "The transcript content hash does not match its cues.");

            var capture = CreateCapture(session, command.Language, "youtubeCaption", contentHash,
                command.DurationMs ?? normalized.Max(item => item.EndMs), normalized, command.IdempotencyKey);
            db.Add(capture);
            session.TranscriptCaptureId = capture.TranscriptCaptureId;
            session.TranscriptStatus = "ready";
            session.QuizStatus = "queued";
            QueueJob(session, "quizGenerate", $"quiz:{session.SessionId}:{contentHash}");
        }
        else
        {
            session.TranscriptStatus = "generating";
            session.QuizStatus = "notStarted";
            QueueJob(session, "transcriptGenerate", $"transcript:{session.SessionId}:{session.YoutubeVideoId}");
        }

        await db.SaveChangesAsync(cancellationToken);
        return LearningPackageResult.Success(await BuildPackageAsync(session, cancellationToken));
    }

    public async Task<LearningPackageResult> GetAsync(string sessionId, CancellationToken cancellationToken)
    {
        var session = await db.Set<StudySessionEntity>().AsNoTracking()
            .SingleOrDefaultAsync(item => item.SessionId == sessionId, cancellationToken);
        return session is null
            ? LearningPackageResult.NotFound("sessionNotFound", "The study session was not found.")
            : LearningPackageResult.Success(await BuildPackageAsync(session, cancellationToken));
    }

    public async Task<LearningPackageResult> RetryAsync(string sessionId, string contractVersion, string operation, CancellationToken cancellationToken)
    {
        var session = await db.Set<StudySessionEntity>().SingleOrDefaultAsync(item => item.SessionId == sessionId, cancellationToken);
        if (session is null) return LearningPackageResult.NotFound("sessionNotFound", "The study session was not found.");
        if (contractVersion != ContractVersion || operation is not ("transcriptGenerate" or "quizGenerate"))
            return LearningPackageResult.Invalid("invalidRetryRequest", "A supported failed operation is required.");
        if (session.ErrorOperation != operation)
            return LearningPackageResult.Invalid("operationNotFailed", "Only the failed processing step can be retried.");
        if (operation == "quizGenerate" && string.IsNullOrWhiteSpace(session.TranscriptCaptureId))
            return LearningPackageResult.Invalid("transcriptNotReady", "A validated transcript is required before quiz generation.");

        var suffix = Guid.NewGuid().ToString("N");
        QueueJob(session, operation, $"retry:{operation}:{session.SessionId}:{suffix}");
        if (operation == "transcriptGenerate") session.TranscriptStatus = "generating";
        else session.QuizStatus = "queued";
        ClearError(session);
        await db.SaveChangesAsync(cancellationToken);
        return LearningPackageResult.Success(await BuildPackageAsync(session, cancellationToken));
    }

    public async Task<LearningPackageResult> CompleteAsync(string sessionId, CompleteLearningSessionCommand command, CancellationToken cancellationToken)
    {
        var session = await db.Set<StudySessionEntity>().SingleOrDefaultAsync(item => item.SessionId == sessionId, cancellationToken);
        if (session is null) return LearningPackageResult.NotFound("sessionNotFound", "The study session was not found.");
        if (command.ContractVersion != ContractVersion || !Guid.TryParse(command.ClientCompletionId, out _) ||
            command.Reason is not ("activationDisabled" or "videoEnded" or "videoContextChanged" or "unsupportedWatchPage"))
            return LearningPackageResult.Invalid("invalidCompletionRequest", "A valid completion request is required.");
        if (session.CompletionId is not null && session.CompletionId != command.ClientCompletionId)
            return LearningPackageResult.Conflict();

        session.CompletionId = command.ClientCompletionId;
        session.CompletionReason = command.Reason;
        session.CompletedAtUtc ??= DateTimeOffset.UtcNow;
        session.Status = command.Reason == "videoEnded" ? "completed" : "closed";
        await db.Set<ProcessingJobEntity>().Where(item => item.SessionId == sessionId && (item.Status == "queued" || item.Status == "running"))
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, "cancelled").SetProperty(item => item.UpdatedAtUtc, DateTimeOffset.UtcNow), cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return LearningPackageResult.Success(await BuildPackageAsync(session, cancellationToken));
    }

    public async Task<LearningPackageView> BuildPackageAsync(StudySessionEntity session, CancellationToken cancellationToken)
    {
        TranscriptView transcript;
        if (session.TranscriptCaptureId is null)
        {
            transcript = new(session.TranscriptStatus, null, null, null, null, 0, []);
        }
        else
        {
            var capture = await db.Set<TranscriptCaptureEntity>().AsNoTracking().Include(item => item.Cues)
                .SingleOrDefaultAsync(item => item.TranscriptCaptureId == session.TranscriptCaptureId, cancellationToken);
            transcript = capture is null
                ? new(session.TranscriptStatus, null, null, null, null, 0, [])
                : new(session.TranscriptStatus, capture.TranscriptCaptureId, capture.Source, capture.Language, capture.ContentHash,
                    capture.Cues.Count, capture.Cues.OrderBy(item => item.StartMs).Select(item => new TranscriptCueView(item.StartMs, item.EndMs, item.Text)).ToArray());
        }

        QuizView? quiz = null;
        if (session.QuizId is not null)
        {
            var entity = await db.Set<QuizAssessmentEntity>().AsNoTracking().Include(item => item.Questions).ThenInclude(item => item.Options)
                .SingleOrDefaultAsync(item => item.QuizId == session.QuizId, cancellationToken);
            if (entity is not null)
            {
                quiz = new QuizView(entity.QuizId, entity.SessionId, "ready", entity.Questions.Select(question =>
                    new LearningQuestionView(question.QuestionId, question.Type, question.Prompt,
                        question.Options.OrderBy(option => option.Position).Select(option => new LearningOptionView(option.OptionId, option.Text)).ToArray(),
                        new LearningSourceView(question.YoutubeVideoId, question.SourceStartMs, question.SourceEndMs))).ToArray(), entity.CreatedAtUtc);
            }
        }

        ProcessingErrorView? error = session.ErrorOperation is null ? null : new(
            session.ErrorOperation, session.ErrorCode ?? "processingFailed", session.ErrorMessage ?? "Processing failed.", session.ErrorRetryable);
        return new LearningPackageView(ToSnapshot(session), transcript, session.QuizStatus, quiz, error);
    }

    public static SessionSnapshotView ToSnapshot(StudySessionEntity session) => new(
        session.SessionId, session.YoutubeVideoId, session.VideoTitle, session.Status,
        new PreferenceSnapshotView(session.QuestionType, session.Difficulty), session.StartedAtUtc, session.CompletedAtUtc);

    private void QueueJob(StudySessionEntity session, string operation, string idempotencyKey)
    {
        db.Add(new ProcessingJobEntity
        {
            ProcessingJobId = Guid.NewGuid().ToString(),
            SessionId = session.SessionId,
            JobType = operation,
            Status = "queued",
            IdempotencyKey = idempotencyKey,
            MaxAttempts = 3,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow,
        });
    }

    private static TranscriptCaptureEntity CreateCapture(StudySessionEntity session, string language, string source,
        string contentHash, long durationMs, IReadOnlyList<TranscriptCueView> cues, string idempotencyKey)
    {
        var captureId = Guid.NewGuid().ToString();
        return new TranscriptCaptureEntity
        {
            TranscriptCaptureId = captureId,
            SessionId = session.SessionId,
            YoutubeVideoId = session.YoutubeVideoId,
            Language = string.IsNullOrWhiteSpace(language) ? "und" : language.Trim().ToLowerInvariant(),
            Source = source,
            Status = "available",
            ContentHash = contentHash,
            DurationMs = durationMs,
            Version = 1,
            CreateIdempotencyKey = idempotencyKey,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            Cues = cues.Select((cue, index) => new TranscriptCaptureCueEntity
            {
                TranscriptCueId = Guid.NewGuid().ToString(),
                TranscriptCaptureId = captureId,
                ChunkIndex = index,
                StartMs = cue.StartMs,
                EndMs = cue.EndMs,
                Text = cue.Text,
            }).ToList(),
        };
    }

    internal static IReadOnlyList<TranscriptCueView> NormalizeCues(IReadOnlyList<TranscriptCueView> cues) => cues
        .Select(item => new TranscriptCueView(item.StartMs, item.EndMs, NormalizeText(item.Text)))
        .Where(item => item.Text.Length > 0)
        .OrderBy(item => item.StartMs).ThenBy(item => item.EndMs).ToArray();

    internal static bool ValidCues(IReadOnlyList<TranscriptCueView> cues) => cues.Count > 0 &&
        cues.All(item => item.StartMs >= 0 && item.EndMs > item.StartMs && item.Text.Length > 0);

    internal static string HashCues(IReadOnlyList<TranscriptCueView> cues)
    {
        var canonical = string.Join('\n', cues.Select(item => $"{item.StartMs}|{item.EndMs}|{item.Text}"));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }

    private static string Fingerprint(SubmitFullTranscriptCommand command, IReadOnlyList<TranscriptCueView> cues) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            $"{command.YoutubeVideoId}|{command.Language}|{command.Source}|{command.Status}|{command.ContentHash}|{command.DurationMs}|{HashCues(cues)}"))).ToLowerInvariant();

    private static string NormalizeText(string value) => string.Join(' ', value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    private static bool ValidStart(StartLearningSessionCommand command) => command.ContractVersion == ContractVersion &&
        Guid.TryParse(command.ActivationId, out _) && !string.IsNullOrWhiteSpace(command.IdempotencyKey) && VideoIdRegex().IsMatch(command.YoutubeVideoId) &&
        !string.IsNullOrWhiteSpace(command.VideoTitle) && command.QuestionType is "multipleChoice" or "shortAnswer" && command.Difficulty is "easy" or "medium" or "hard";
    private static bool ValidTranscriptEnvelope(StudySessionEntity session, SubmitFullTranscriptCommand command) =>
        command.ContractVersion == ContractVersion && session.Status == "active" && command.YoutubeVideoId == session.YoutubeVideoId &&
        !string.IsNullOrWhiteSpace(command.IdempotencyKey) && !string.IsNullOrWhiteSpace(command.Language) && command.Source == "youtubeCaption" &&
        command.Status is "available" or "unavailable" or "insufficient" && (command.Status == "available" || command.Cues.Count == 0);
    private static bool SameStart(StudySessionEntity entity, StartLearningSessionCommand command) =>
        entity.ActivationId == command.ActivationId && entity.YoutubeVideoId == command.YoutubeVideoId && entity.VideoTitle == command.VideoTitle.Trim() &&
        entity.QuestionType == command.QuestionType && entity.Difficulty == command.Difficulty;
    private static void ClearError(StudySessionEntity session)
    {
        session.ErrorOperation = null;
        session.ErrorCode = null;
        session.ErrorMessage = null;
        session.ErrorRetryable = false;
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{11}$")]
    private static partial Regex VideoIdRegex();
}

public sealed record StartLearningSessionCommand(string ContractVersion, string ActivationId, string IdempotencyKey,
    string YoutubeVideoId, string VideoTitle, string QuestionType, string Difficulty);
public sealed record SubmitFullTranscriptCommand(string ContractVersion, string IdempotencyKey, string YoutubeVideoId,
    string Language, string Source, string Status, string? ContentHash, long? DurationMs, IReadOnlyList<TranscriptCueView> Cues);
public sealed record CompleteLearningSessionCommand(string ContractVersion, string ClientCompletionId, string Reason);
public sealed record PreferenceSnapshotView(string QuestionType, string Difficulty);
public sealed record SessionSnapshotView(string SessionId, string YoutubeVideoId, string VideoTitle, string Status,
    PreferenceSnapshotView Preferences, DateTimeOffset StartedAtUtc, DateTimeOffset? CompletedAtUtc);
public sealed record TranscriptCueView(long StartMs, long EndMs, string Text);
public sealed record TranscriptView(string Status, string? TranscriptCaptureId, string? Source, string? Language,
    string? ContentHash, int CueCount, IReadOnlyList<TranscriptCueView> Cues);
public sealed record LearningOptionView(string OptionId, string Text);
public sealed record LearningSourceView(string YoutubeVideoId, long StartMs, long EndMs);
public sealed record LearningQuestionView(string QuestionId, string Type, string Prompt, IReadOnlyList<LearningOptionView> Options, LearningSourceView Source);
public sealed record QuizView(string QuizId, string SessionId, string Status, IReadOnlyList<LearningQuestionView> Questions, DateTimeOffset CreatedAtUtc);
public sealed record ProcessingErrorView(string Operation, string Code, string Message, bool Retryable);
public sealed record LearningPackageView(SessionSnapshotView Session, TranscriptView Transcript, string QuizStatus, QuizView? Quiz, ProcessingErrorView? Error);
public sealed record LearningPackageResult(LearningPackageView? Package, string? ErrorCode, string? ErrorMessage, int StatusCode)
{
    public static LearningPackageResult Success(LearningPackageView package) => new(package, null, null, StatusCodes.Status200OK);
    public static LearningPackageResult Invalid(string code, string message) => new(null, code, message, StatusCodes.Status400BadRequest);
    public static LearningPackageResult NotFound(string code, string message) => new(null, code, message, StatusCodes.Status404NotFound);
    public static LearningPackageResult Conflict() => new(null, "idempotencyConflict", "The idempotency key was already used with a different payload.", StatusCodes.Status409Conflict);
}
