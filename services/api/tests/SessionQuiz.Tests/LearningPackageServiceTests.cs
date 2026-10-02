using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Features.VideoActivation.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;
using Xunit;

namespace SessionQuiz.Tests;

public sealed class LearningPackageServiceTests
{
    [Fact]
    public async Task Start_CreatesSessionBeforeTranscript_AndReplaysIdempotently()
    {
        await using var fixture = await DatabaseFixture.CreateAsync();
        var service = new LearningPackageService(fixture.Db);
        var command = StartCommand();

        var first = await service.StartAsync(command, CancellationToken.None);
        var replay = await service.StartAsync(command, CancellationToken.None);

        Assert.NotNull(first.Package);
        Assert.Equal(first.Package!.Session.SessionId, replay.Package!.Session.SessionId);
        Assert.Equal("active", first.Package.Session.Status);
        Assert.Equal("waiting", first.Package.Transcript.Status);
        Assert.Equal("notStarted", first.Package.QuizStatus);
        Assert.Single(await fixture.Db.Set<StudySessionEntity>().ToArrayAsync());
        Assert.Single(await fixture.Db.Set<StudyVideoEntity>().ToArrayAsync());
    }

    [Fact]
    public async Task ConcurrentStart_WithSameIdempotencyKey_ReplaysOneSession()
    {
        var databasePath = TemporaryDatabasePath();
        try
        {
            var options = FileDatabaseOptions(databasePath);
            await using (var setup = new StudyLensDbContext(options))
                await setup.Database.EnsureCreatedAsync();
            await using var firstDb = new StudyLensDbContext(options);
            await using var secondDb = new StudyLensDbContext(options);
            var command = StartCommand();

            var results = await Task.WhenAll(
                new LearningPackageService(firstDb).StartAsync(command, CancellationToken.None),
                new LearningPackageService(secondDb).StartAsync(command, CancellationToken.None));

            Assert.All(results, result => Assert.Equal(StatusCodes.Status200OK, result.StatusCode));
            Assert.Equal(results[0].Package!.Session.SessionId, results[1].Package!.Session.SessionId);
            await using var verification = new StudyLensDbContext(options);
            Assert.Single(await verification.Set<StudySessionEntity>().ToArrayAsync());
            Assert.Single(await verification.Set<StudyVideoEntity>().ToArrayAsync());
        }
        finally
        {
            DeleteTemporaryDatabase(databasePath);
        }
    }

    [Fact]
    public async Task ConcurrentStart_WithConflictingPayloadForSameKey_ReturnsOneConflict()
    {
        var databasePath = TemporaryDatabasePath();
        try
        {
            var options = FileDatabaseOptions(databasePath);
            await using (var setup = new StudyLensDbContext(options))
                await setup.Database.EnsureCreatedAsync();
            await using var firstDb = new StudyLensDbContext(options);
            await using var secondDb = new StudyLensDbContext(options);
            var command = StartCommand();

            var results = await Task.WhenAll(
                new LearningPackageService(firstDb).StartAsync(command, CancellationToken.None),
                new LearningPackageService(secondDb).StartAsync(command with { VideoTitle = "Different lesson" }, CancellationToken.None));

            Assert.Contains(results, result => result.StatusCode == StatusCodes.Status200OK);
            Assert.Contains(results, result => result.StatusCode == StatusCodes.Status409Conflict);
            await using var verification = new StudyLensDbContext(options);
            Assert.Single(await verification.Set<StudySessionEntity>().ToArrayAsync());
        }
        finally
        {
            DeleteTemporaryDatabase(databasePath);
        }
    }

    [Fact]
    public async Task ConcurrentStart_DifferentActivationsSameVideo_CreatesTwoSessionsAndOneVideo()
    {
        var databasePath = TemporaryDatabasePath();
        try
        {
            var setupOptions = FileDatabaseOptions(databasePath);
            await using (var setup = new StudyLensDbContext(setupOptions))
                await setup.Database.EnsureCreatedAsync();
            var saveBarrier = new TwoPartySaveBarrierInterceptor();
            var concurrentOptions = FileDatabaseOptions(databasePath, saveBarrier);
            await using var firstDb = new StudyLensDbContext(concurrentOptions);
            await using var secondDb = new StudyLensDbContext(concurrentOptions);
            var firstCommand = StartCommand();
            var secondCommand = firstCommand with
            {
                ActivationId = "22222222-2222-4222-8222-222222222222",
                IdempotencyKey = "session:activation-2:dQw4w9WgXcQ",
            };

            var results = await Task.WhenAll(
                new LearningPackageService(firstDb).StartAsync(firstCommand, CancellationToken.None),
                new LearningPackageService(secondDb).StartAsync(secondCommand, CancellationToken.None));

            Assert.All(results, result => Assert.Equal(StatusCodes.Status200OK, result.StatusCode));
            Assert.NotEqual(results[0].Package!.Session.SessionId, results[1].Package!.Session.SessionId);
            await using var verification = new StudyLensDbContext(setupOptions);
            Assert.Equal(2, await verification.Set<StudySessionEntity>().CountAsync());
            Assert.Single(await verification.Set<StudyVideoEntity>().ToArrayAsync());
        }
        finally
        {
            DeleteTemporaryDatabase(databasePath);
        }
    }

    [Fact]
    public async Task SubmitFullTranscript_ValidatesHash_PersistsCues_AndQueuesOneQuiz()
    {
        await using var fixture = await DatabaseFixture.CreateAsync();
        var service = new LearningPackageService(fixture.Db);
        var started = (await service.StartAsync(StartCommand(), CancellationToken.None)).Package!;
        TranscriptCueView[] cues =
        [
            new(0, 5_000, "  Intro   to networks "),
            new(5_000, 12_000, "IP routes packets."),
        ];
        var normalizedHash = Hash("0|5000|Intro to networks\n5000|12000|IP routes packets.");
        var command = new SubmitFullTranscriptCommand(
            "0.5.0", $"transcript:{started.Session.SessionId}:{normalizedHash}", "dQw4w9WgXcQ",
            "en", "youtubeCaption", "available", normalizedHash, 12_000, cues);

        var accepted = await service.SubmitTranscriptAsync(started.Session.SessionId, command, CancellationToken.None);
        var replay = await service.SubmitTranscriptAsync(started.Session.SessionId, command, CancellationToken.None);

        Assert.Equal("ready", accepted.Package!.Transcript.Status);
        Assert.Equal("youtubeCaption", accepted.Package.Transcript.Source);
        Assert.Equal(2, accepted.Package.Transcript.CueCount);
        Assert.Equal("queued", accepted.Package.QuizStatus);
        Assert.Equal(accepted.Package.Transcript.TranscriptCaptureId, replay.Package!.Transcript.TranscriptCaptureId);
        Assert.Single(await fixture.Db.Set<ProcessingJobEntity>().Where(item => item.JobType == "quizGenerate").ToArrayAsync());

        var conflict = await service.SubmitTranscriptAsync(started.Session.SessionId,
            command with { ContentHash = new string('a', 64), IdempotencyKey = command.IdempotencyKey }, CancellationToken.None);
        Assert.Equal(StatusCodes.Status409Conflict, conflict.StatusCode);
        Assert.Equal("idempotencyConflict", conflict.ErrorCode);
    }

    [Fact]
    public async Task ConcurrentTranscriptSubmit_ReplaysOneCaptureAndOneJob()
    {
        var databasePath = TemporaryDatabasePath();
        try
        {
            var options = FileDatabaseOptions(databasePath);
            string sessionId;
            await using (var setup = new StudyLensDbContext(options))
            {
                await setup.Database.EnsureCreatedAsync();
                sessionId = (await new LearningPackageService(setup).StartAsync(StartCommand(), CancellationToken.None))
                    .Package!.Session.SessionId;
            }
            var command = new SubmitFullTranscriptCommand(
                "0.5.0", "transcript:concurrent", "dQw4w9WgXcQ", "en", "youtubeCaption", "available",
                null, 10_000, [new TranscriptCueView(0, 10_000, "One complete transcript cue")]);
            await using var firstDb = new StudyLensDbContext(options);
            await using var secondDb = new StudyLensDbContext(options);

            var results = await Task.WhenAll(
                new LearningPackageService(firstDb).SubmitTranscriptAsync(sessionId, command, CancellationToken.None),
                new LearningPackageService(secondDb).SubmitTranscriptAsync(sessionId, command, CancellationToken.None));

            Assert.All(results, result => Assert.Equal(StatusCodes.Status200OK, result.StatusCode));
            Assert.Equal(results[0].Package!.Transcript.TranscriptCaptureId, results[1].Package!.Transcript.TranscriptCaptureId);
            await using var verification = new StudyLensDbContext(options);
            Assert.Single(await verification.Set<TranscriptCaptureEntity>().ToArrayAsync());
            Assert.Single(await verification.Set<ProcessingJobEntity>().ToArrayAsync());
        }
        finally
        {
            DeleteTemporaryDatabase(databasePath);
        }
    }

    [Fact]
    public async Task ConcurrentTranscriptSubmit_WithConflictingPayload_ReturnsOneConflict()
    {
        var databasePath = TemporaryDatabasePath();
        try
        {
            var options = FileDatabaseOptions(databasePath);
            string sessionId;
            await using (var setup = new StudyLensDbContext(options))
            {
                await setup.Database.EnsureCreatedAsync();
                sessionId = (await new LearningPackageService(setup).StartAsync(StartCommand(), CancellationToken.None))
                    .Package!.Session.SessionId;
            }
            var command = new SubmitFullTranscriptCommand(
                "0.5.0", "transcript:concurrent-conflict", "dQw4w9WgXcQ", "en", "youtubeCaption", "available",
                null, 10_000, [new TranscriptCueView(0, 10_000, "First transcript payload")]);
            await using var firstDb = new StudyLensDbContext(options);
            await using var secondDb = new StudyLensDbContext(options);

            var results = await Task.WhenAll(
                new LearningPackageService(firstDb).SubmitTranscriptAsync(sessionId, command, CancellationToken.None),
                new LearningPackageService(secondDb).SubmitTranscriptAsync(sessionId,
                    command with { Cues = [new TranscriptCueView(0, 10_000, "Different transcript payload")] },
                    CancellationToken.None));

            Assert.Contains(results, result => result.StatusCode == StatusCodes.Status200OK);
            Assert.Contains(results, result => result.StatusCode == StatusCodes.Status409Conflict);
            await using var verification = new StudyLensDbContext(options);
            Assert.Single(await verification.Set<TranscriptCaptureEntity>().ToArrayAsync());
            Assert.Single(await verification.Set<ProcessingJobEntity>().ToArrayAsync());
        }
        finally
        {
            DeleteTemporaryDatabase(databasePath);
        }
    }

    [Fact]
    public async Task ConcurrentRetry_RequeuesTheSameFailedJobOnce()
    {
        var databasePath = TemporaryDatabasePath();
        try
        {
            var options = FileDatabaseOptions(databasePath);
            string sessionId;
            string jobId;
            await using (var setup = new StudyLensDbContext(options))
            {
                await setup.Database.EnsureCreatedAsync();
                var service = new LearningPackageService(setup);
                sessionId = (await service.StartAsync(StartCommand(), CancellationToken.None)).Package!.Session.SessionId;
                await service.SubmitTranscriptAsync(sessionId,
                    new SubmitFullTranscriptCommand("0.5.0", "transcript:retry-concurrent", "dQw4w9WgXcQ",
                        "und", "youtubeCaption", "unavailable", null, null, []), CancellationToken.None);
                var session = await setup.Set<StudySessionEntity>().SingleAsync();
                var failedJob = await setup.Set<ProcessingJobEntity>().SingleAsync();
                session.Status = "failed";
                session.TranscriptStatus = "failed";
                session.ErrorOperation = "transcriptGenerate";
                session.ErrorCode = "providerTimeout";
                session.ErrorMessage = "Timed out";
                session.ErrorRetryable = true;
                failedJob.Status = "failed";
                failedJob.AttemptCount = 3;
                failedJob.LastErrorCode = "providerTimeout";
                failedJob.LastErrorMessage = "Timed out";
                failedJob.LastErrorRetryable = true;
                jobId = failedJob.ProcessingJobId;
                await setup.SaveChangesAsync();
            }
            await using var firstDb = new StudyLensDbContext(options);
            await using var secondDb = new StudyLensDbContext(options);

            var results = await Task.WhenAll(
                new LearningPackageService(firstDb).RetryAsync(sessionId, "0.5.0", "transcriptGenerate", CancellationToken.None),
                new LearningPackageService(secondDb).RetryAsync(sessionId, "0.5.0", "transcriptGenerate", CancellationToken.None));

            Assert.All(results, result => Assert.Equal(StatusCodes.Status200OK, result.StatusCode));
            await using var verification = new StudyLensDbContext(options);
            var jobs = await verification.Set<ProcessingJobEntity>().ToArrayAsync();
            var job = Assert.Single(jobs);
            Assert.Equal(jobId, job.ProcessingJobId);
            Assert.Equal("queued", job.Status);
            Assert.Equal(0, job.AttemptCount);
        }
        finally
        {
            DeleteTemporaryDatabase(databasePath);
        }
    }

    [Fact]
    public async Task SubmitFullTranscript_MatchesCrossLanguageCanonicalFixture()
    {
        await using var fixture = await DatabaseFixture.CreateAsync();
        var service = new LearningPackageService(fixture.Db);
        var started = (await service.StartAsync(StartCommand(), CancellationToken.None)).Package!;
        using var document = JsonDocument.Parse(await File.ReadAllTextAsync(
            Path.Combine(AppContext.BaseDirectory, "transcript-hash-canonical.json")));
        var root = document.RootElement;
        var hash = root.GetProperty("contentHash").GetString()!;
        var cues = root.GetProperty("rawCues").EnumerateArray()
            .Select(item => new TranscriptCueView(item.GetProperty("startMs").GetInt64(),
                item.GetProperty("endMs").GetInt64(), item.GetProperty("text").GetString()!)).ToArray();

        var command = new SubmitFullTranscriptCommand("0.5.0", $"transcript:{started.Session.SessionId}:{hash}",
            "dQw4w9WgXcQ", "en", "youtubeCaption", "available", hash, 30_000, cues);
        var invalid = await service.SubmitTranscriptAsync(started.Session.SessionId,
            command with { ContentHash = new string('0', 64) }, CancellationToken.None);
        Assert.Equal("transcriptHashMismatch", invalid.ErrorCode);
        Assert.Empty(await fixture.Db.Set<ProcessingJobEntity>().ToArrayAsync());

        var result = await service.SubmitTranscriptAsync(started.Session.SessionId, command, CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, result.StatusCode);
        Assert.Equal(hash, result.Package!.Transcript.ContentHash);
        Assert.Equal(3, result.Package.Transcript.CueCount);
        Assert.Single(await fixture.Db.Set<ProcessingJobEntity>().Where(item => item.JobType == "quizGenerate").ToArrayAsync());
    }

    [Fact]
    public async Task MissingYoutubeCaption_QueuesDurableTranscriptFallback()
    {
        await using var fixture = await DatabaseFixture.CreateAsync();
        var service = new LearningPackageService(fixture.Db);
        var started = (await service.StartAsync(StartCommand(), CancellationToken.None)).Package!;

        var result = await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.5.0", $"transcript:{started.Session.SessionId}:unavailable", "dQw4w9WgXcQ",
                "und", "youtubeCaption", "unavailable", null, null, []), CancellationToken.None);

        Assert.Equal("generating", result.Package!.Transcript.Status);
        Assert.Equal("notStarted", result.Package.QuizStatus);
        var job = await fixture.Db.Set<ProcessingJobEntity>().SingleAsync();
        Assert.Equal("transcriptGenerate", job.JobType);
        Assert.Equal("queued", job.Status);
        Assert.Equal(3, job.MaxAttempts);
    }

    [Fact]
    public async Task VideoEndedBeforeQuizReady_ClosesSessionWithoutCompletionOrHistory()
    {
        await using var fixture = await DatabaseFixture.CreateAsync();
        var service = new LearningPackageService(fixture.Db);
        var started = (await service.StartAsync(StartCommand(), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.5.0", "transcript:close-before-quiz", "dQw4w9WgXcQ",
                "en", "youtubeCaption", "available", null, 30_000,
                [new TranscriptCueView(0, 1_000, "A complete caption cue")]), CancellationToken.None);

        var completed = await service.CompleteAsync(started.Session.SessionId,
            new CompleteLearningSessionCommand("0.5.0", Guid.NewGuid().ToString(), "videoEnded"), CancellationToken.None);

        Assert.Equal("closed", completed.Package!.Session.Status);
        Assert.Empty(await fixture.Db.Set<QuizAssessmentEntity>().ToArrayAsync());
        Assert.Empty(await fixture.Db.Set<TranscriptCaptureEntity>().ToArrayAsync());
        Assert.Null(completed.Package.Transcript.TranscriptCaptureId);
        Assert.All(await fixture.Db.Set<ProcessingJobEntity>().ToArrayAsync(), job => Assert.Equal("cancelled", job.Status));
    }

    private static StartLearningSessionCommand StartCommand() => new(
        "0.5.0", "11111111-1111-4111-8111-111111111111", "session:activation-1:dQw4w9WgXcQ",
        "dQw4w9WgXcQ", "Networking lesson", "multipleChoice", "medium");

    private static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private static string TemporaryDatabasePath() =>
        Path.Combine(Path.GetTempPath(), $"studylens-session-quiz-{Guid.NewGuid():N}.db");

    private static DbContextOptions<StudyLensDbContext> FileDatabaseOptions(
        string databasePath, IInterceptor? interceptor = null)
    {
        var builder = new DbContextOptionsBuilder<StudyLensDbContext>()
            .UseSqlite($"Data Source={databasePath};Default Timeout=10;Pooling=False");
        if (interceptor is not null) builder.AddInterceptors(interceptor);
        return builder.Options;
    }

    private static void DeleteTemporaryDatabase(string databasePath)
    {
        foreach (var suffix in new[] { string.Empty, "-wal", "-shm" })
        {
            var path = databasePath + suffix;
            if (File.Exists(path)) File.Delete(path);
        }
    }

    private sealed class TwoPartySaveBarrierInterceptor : SaveChangesInterceptor
    {
        private readonly TaskCompletionSource release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int arrivals;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (Interlocked.Increment(ref arrivals) >= 2) release.TrySetResult();
            await release.Task.WaitAsync(cancellationToken);
            return result;
        }
    }

    private sealed class DatabaseFixture : IAsyncDisposable
    {
        private DatabaseFixture(StudyLensDbContext db) => Db = db;
        public StudyLensDbContext Db { get; }

        public static async Task<DatabaseFixture> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
            var db = new StudyLensDbContext(options);
            await db.Database.OpenConnectionAsync();
            await db.Database.EnsureCreatedAsync();
            return new DatabaseFixture(db);
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
