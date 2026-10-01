using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Features.VideoActivation.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;

namespace StudyLens.Api.Features.SessionQuiz.Application;

public sealed class LearningPackageWorker(IServiceScopeFactory scopeFactory, ILogger<LearningPackageWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RecoverRunningJobsAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var processed = await ProcessNextAsync(stoppingToken);
                if (!processed) await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception exception)
            {
                logger.LogError(exception, "The learning-package worker failed outside a persisted job.");
                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            }
        }
    }

    private async Task RecoverRunningJobsAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<StudyLensDbContext>();
        var now = DateTimeOffset.UtcNow;
        await db.Set<ProcessingJobEntity>().Where(item => item.Status == "running")
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, "queued").SetProperty(item => item.UpdatedAtUtc, now), cancellationToken);
    }

    internal async Task<bool> ProcessNextAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<StudyLensDbContext>();
        var queued = db.Set<ProcessingJobEntity>().Where(item => item.Status == "queued");
        var job = db.Database.IsSqlite()
            ? (await queued.ToArrayAsync(cancellationToken)).OrderBy(item => item.CreatedAtUtc).FirstOrDefault()
            : await queued.OrderBy(item => item.CreatedAtUtc).FirstOrDefaultAsync(cancellationToken);
        if (job is null) return false;

        var session = await db.Set<StudySessionEntity>().SingleOrDefaultAsync(item => item.SessionId == job.SessionId, cancellationToken);
        if (session is null || session.Status is "closed" or "completed" or "failed")
        {
            job.Status = "cancelled";
            job.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }

        job.Status = "running";
        job.AttemptCount += 1;
        job.UpdatedAtUtc = DateTimeOffset.UtcNow;
        if (job.JobType == "transcriptGenerate") session.TranscriptStatus = "generating";
        if (job.JobType == "quizGenerate") session.QuizStatus = "generating";
        await db.SaveChangesAsync(cancellationToken);

        AiJobOutcome outcome;
        try
        {
            outcome = job.JobType switch
            {
                "transcriptGenerate" => await GenerateTranscriptAsync(scope.ServiceProvider, db, session, job, cancellationToken),
                "quizGenerate" => await GenerateQuizAsync(scope.ServiceProvider, db, session, job, cancellationToken),
                _ => AiJobOutcome.Fail("unknownJobType", "The persisted processing job is not supported.", false),
            };
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Processing job {JobId} failed.", job.ProcessingJobId);
            outcome = AiJobOutcome.Fail("processingFailed", "The processing job failed unexpectedly.", true);
        }

        // The AI request can outlive the video context. Do not commit a late
        // capture/quiz into a session that was closed while the request ran.
        var persistedSession = await db.Entry(session).GetDatabaseValuesAsync(cancellationToken);
        var persistedJob = await db.Entry(job).GetDatabaseValuesAsync(cancellationToken);
        if (persistedSession?.GetValue<string>(nameof(StudySessionEntity.Status)) != "active" ||
            persistedJob?.GetValue<string>(nameof(ProcessingJobEntity.Status)) != "running")
        {
            db.ChangeTracker.Clear();
            return true;
        }

        if (outcome.Succeeded)
        {
            job.Status = "succeeded";
            job.LastErrorCode = null;
            job.LastErrorMessage = null;
            job.LastErrorRetryable = false;
        }
        else
        {
            job.LastErrorCode = outcome.Code;
            job.LastErrorMessage = outcome.Message;
            job.LastErrorRetryable = outcome.Retryable;
            // A quota limit needs time or a user action to clear. Persist the
            // retryable failure now instead of immediately spending more calls.
            var exhausted = ShouldStopAutomaticRetries(outcome, job.AttemptCount, job.MaxAttempts);
            job.Status = exhausted ? "failed" : "queued";
            if (exhausted)
            {
                session.Status = "failed";
                session.ErrorOperation = job.JobType;
                session.ErrorCode = outcome.Code;
                session.ErrorMessage = outcome.Message;
                session.ErrorRetryable = outcome.Retryable;
                if (job.JobType == "transcriptGenerate")
                {
                    session.TranscriptStatus = outcome.Code == "videoUnavailable" ? "unavailable" : "failed";
                    session.QuizStatus = "notStarted";
                }
                else session.QuizStatus = "failed";
            }
            else
            {
                if (job.JobType == "transcriptGenerate") session.TranscriptStatus = "generating";
                else session.QuizStatus = "queued";
            }
        }
        job.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    internal static bool ShouldStopAutomaticRetries(AiJobOutcome outcome, int attemptCount, int maxAttempts) =>
        attemptCount >= maxAttempts || !outcome.Retryable || outcome.Code == "providerRateLimited";

    private static async Task<AiJobOutcome> GenerateTranscriptAsync(IServiceProvider services, StudyLensDbContext db,
        StudySessionEntity session, ProcessingJobEntity job, CancellationToken cancellationToken)
    {
        var gateway = services.GetRequiredService<ITranscriptGenerationGateway>();
        var generated = await gateway.GenerateAsync(new(LearningPackageService.ContractVersion, session.YoutubeVideoId), cancellationToken);
        if (generated.Value is null) return AiJobOutcome.Fail(generated.ErrorCode!, generated.ErrorMessage!, generated.Retryable);
        if (generated.Value.ContractVersion != LearningPackageService.ContractVersion || generated.Value.YoutubeVideoId != session.YoutubeVideoId || generated.Value.Source != "geminiVideo")
            return AiJobOutcome.Fail("invalidAiResponse", "The generated transcript did not match the requested video.", false);
        var cues = LearningPackageService.NormalizeCues(generated.Value.Cues);
        if (!LearningPackageService.ValidCues(cues))
            return AiJobOutcome.Fail("invalidAiTranscript", "The AI Service did not return usable timestamped transcript cues.", false);

        var hash = LearningPackageService.HashCues(cues);
        var captureId = Guid.NewGuid().ToString();
        var capture = new TranscriptCaptureEntity
        {
            TranscriptCaptureId = captureId,
            SessionId = session.SessionId,
            YoutubeVideoId = session.YoutubeVideoId,
            Language = generated.Value.Language.Trim().ToLowerInvariant(),
            Source = "geminiVideo",
            Status = "available",
            ContentHash = hash,
            DurationMs = generated.Value.DurationMs ?? cues.Max(item => item.EndMs),
            Version = 1,
            CreateIdempotencyKey = job.IdempotencyKey,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            Cues = cues.Select((cue, index) => new TranscriptCaptureCueEntity
            {
                TranscriptCueId = Guid.NewGuid().ToString(), TranscriptCaptureId = captureId, ChunkIndex = index,
                StartMs = cue.StartMs, EndMs = cue.EndMs, Text = cue.Text,
            }).ToList(),
        };
        db.Add(capture);
        var video = await db.Set<StudyVideoEntity>().SingleAsync(item => item.YoutubeVideoId == session.YoutubeVideoId, cancellationToken);
        video.DurationMs = capture.DurationMs;
        session.TranscriptCaptureId = captureId;
        session.TranscriptStatus = "ready";
        session.QuizStatus = "queued";
        session.ErrorOperation = null;
        session.ErrorCode = null;
        session.ErrorMessage = null;
        session.ErrorRetryable = false;
        db.Add(new ProcessingJobEntity
        {
            ProcessingJobId = Guid.NewGuid().ToString(), SessionId = session.SessionId, JobType = "quizGenerate",
            Status = "queued", IdempotencyKey = $"quiz:{session.SessionId}:{hash}", MaxAttempts = 3,
            CreatedAtUtc = DateTimeOffset.UtcNow, UpdatedAtUtc = DateTimeOffset.UtcNow,
        });
        return AiJobOutcome.Ok();
    }

    internal static async Task<AiJobOutcome> GenerateQuizAsync(IServiceProvider services, StudyLensDbContext db,
        StudySessionEntity session, ProcessingJobEntity job, CancellationToken cancellationToken)
    {
        if (session.TranscriptCaptureId is null)
            return AiJobOutcome.Fail("transcriptNotReady", "A validated transcript is required before quiz generation.", false);
        var capture = await db.Set<TranscriptCaptureEntity>().AsNoTracking().Include(item => item.Cues)
            .SingleOrDefaultAsync(item => item.TranscriptCaptureId == session.TranscriptCaptureId, cancellationToken);
        if (capture is null || capture.Cues.Count == 0)
            return AiJobOutcome.Fail("transcriptNotReady", "The validated transcript could not be loaded.", false);

        var cues = capture.Cues.OrderBy(item => item.StartMs).Select(item => new TranscriptCueView(item.StartMs, item.EndMs, item.Text)).ToArray();
        var startMs = cues.Min(item => item.StartMs);
        // YouTube caption cues can extend slightly beyond the player-reported duration.
        // The AI request range must still contain every persisted cue.
        var lastCueEndMs = cues.Max(item => item.EndMs);
        var endMs = Math.Max(capture.DurationMs.GetValueOrDefault(), lastCueEndMs);
        // Count by the stored player duration, not a caption that slightly
        // extends past a threshold. Fall back to the last cue for old captures.
        var questionCount = QuestionCountForDuration(capture.DurationMs is > 0 ? capture.DurationMs.Value : lastCueEndMs);
        var gateway = services.GetRequiredService<IFullVideoQuestionGenerationGateway>();
        var generated = await gateway.GenerateAsync(new(LearningPackageService.ContractVersion, LearningPackageService.ContractVersion,
            session.SessionId, capture.TranscriptCaptureId, session.YoutubeVideoId, startMs, endMs, questionCount,
            session.QuestionType, session.Difficulty, cues), cancellationToken);
        if (generated.Value is null) return AiJobOutcome.Fail(generated.ErrorCode!, generated.ErrorMessage!, generated.Retryable);

        var valid = generated.Value.Questions.Where(question => ValidQuestion(question, session.QuestionType, startMs, endMs)).Take(questionCount).ToArray();
        if (valid.Length == 0) return AiJobOutcome.Fail("invalidAiOutput", "The AI Service did not return valid quiz questions.", false);
        var quizId = Guid.NewGuid().ToString();
        var quiz = new QuizAssessmentEntity
        {
            QuizId = quizId,
            IdempotencyKey = job.IdempotencyKey,
            SessionId = session.SessionId,
            SegmentId = string.Empty,
            YoutubeVideoId = session.YoutubeVideoId,
            Status = "ready",
            QuestionType = session.QuestionType,
            Difficulty = session.Difficulty,
            TranscriptCaptureId = capture.TranscriptCaptureId,
            PromptVersion = generated.Value.PromptVersion,
            ModelName = services.GetRequiredService<IConfiguration>()["AiService:QuestionGenerationModel"],
            CreatedAtUtc = DateTimeOffset.UtcNow,
            Questions = valid.Select((question, position) =>
            {
                var questionId = Guid.NewGuid().ToString();
                return new QuestionAssessmentEntity
                {
                    QuestionId = questionId,
                    QuizId = quizId,
                    Type = question.Type,
                    Position = position,
                    Prompt = question.Prompt.Trim(),
                    CorrectOptionId = question.CorrectOptionId,
                    ReferenceAnswer = question.ReferenceAnswer,
                    Explanation = question.Explanation.Trim(),
                    YoutubeVideoId = session.YoutubeVideoId,
                    SourceStartMs = question.SourceStartMs,
                    SourceEndMs = question.SourceEndMs,
                    Options = question.Options?.Select((option, index) => new QuestionOptionEntity
                    {
                        QuestionOptionId = Guid.NewGuid().ToString(), QuestionId = questionId,
                        OptionId = option.OptionId, Text = option.Text, Position = index,
                    }).ToList() ?? [],
                };
            }).ToList(),
        };
        db.Add(quiz);
        session.QuizId = quizId;
        session.QuizStatus = "ready";
        session.ErrorOperation = null;
        session.ErrorCode = null;
        session.ErrorMessage = null;
        session.ErrorRetryable = false;
        return AiJobOutcome.Ok();
    }

    internal static int QuestionCountForDuration(long durationMs) => durationMs switch
    {
        < 600_000 => 3,
        < 1_800_000 => 5,
        < 3_600_000 => 10,
        _ => 15,
    };

    private static bool ValidQuestion(FullVideoGeneratedQuestion question, string requestedType, long startMs, long endMs) =>
        question.Type == requestedType && !string.IsNullOrWhiteSpace(question.Prompt) && !string.IsNullOrWhiteSpace(question.Explanation) &&
        question.SourceStartMs >= startMs && question.SourceEndMs <= endMs && question.SourceEndMs > question.SourceStartMs &&
        (question.Type == "multipleChoice"
            ? question.Options is { Count: >= 2 } && !string.IsNullOrWhiteSpace(question.CorrectOptionId) &&
              question.Options.Any(option => option.OptionId == question.CorrectOptionId) &&
              question.Options.All(option => !string.IsNullOrWhiteSpace(option.OptionId) && !string.IsNullOrWhiteSpace(option.Text))
            : !string.IsNullOrWhiteSpace(question.ReferenceAnswer));
}

internal sealed record AiJobOutcome(bool Succeeded, string? Code, string? Message, bool Retryable)
{
    public static AiJobOutcome Ok() => new(true, null, null, false);
    public static AiJobOutcome Fail(string code, string message, bool retryable) => new(false, code, message, retryable);
}
