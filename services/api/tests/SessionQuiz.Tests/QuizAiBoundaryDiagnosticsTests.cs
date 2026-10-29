using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;
using Xunit;

namespace SessionQuiz.Tests;

public sealed class QuizAiBoundaryDiagnosticsTests
{
    [Theory]
    [InlineData(false, 65_000L, 66_000L, true)]
    [InlineData(true, 65_000L, 66_000L, true)]
    [InlineData(true, 65_000L, 70_000L, true)]
    [InlineData(true, 65_000L, 71_000L, true)]
    [InlineData(true, 65_001L, 66_000L, false)]
    [InlineData(true, 65_000L, 66_500L, false)]
    [InlineData(true, 65_000L, 120_001L, false)]
    public async Task QuizEvidenceBoundaries_AcceptOverlappingCuesButRejectInventedTimestamps(
        bool overlappingCaption, long sourceStartMs, long sourceEndMs, bool expectedReady)
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();

        var service = new LearningPackageService(db);
        var started = (await service.StartAsync(new StartLearningSessionCommand(
            "0.7.0", Guid.NewGuid().ToString(), $"session:overlap:{overlappingCaption}",
            "2b5YsAvWyWU", "Caption overlap", "multipleChoice", "medium"), CancellationToken.None)).Package!;

        // Both variants include the exact cited cue. The overlapping variant
        // models YouTube's repeated text with the same start and a later end.
        TranscriptCueView[] cues = overlappingCaption
            ? [new(65_000, 66_000, "The first caption."), new(65_000, 70_000, "The extended caption."),
               new(66_000, 71_000, "The next caption.")]
            : [new(65_000, 66_000, "The first caption."), new(70_000, 71_000, "The next caption.")];
        var submitted = await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.7.0", $"transcript:overlap:{overlappingCaption}",
                "2b5YsAvWyWU", "vi", "youtubeCaption", "available", null, 120_000, cues), CancellationToken.None);
        Assert.Equal("queued", submitted.Package!.QuizStatus);
        Assert.Equal(cues.Length, await db.Set<StudyLens.Api.Features.VideoActivation.Infrastructure.TranscriptCaptureCueEntity>().CountAsync());

        var gateway = new ExactCueQuestionGateway(sourceStartMs, sourceEndMs);
        var diagnosticLog = new RecordingLogger();
        using var provider = new ServiceCollection()
            .AddSingleton(db)
            .AddSingleton<IFullVideoQuestionGenerationGateway>(gateway)
            .AddSingleton<ILogger<LearningPackageWorker>>(diagnosticLog)
            .AddSingleton<IConfiguration>(new ConfigurationBuilder().Build())
            .BuildServiceProvider();
        var worker = new LearningPackageWorker(provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<LearningPackageWorker>.Instance);

        Assert.True(await worker.ProcessNextAsync(CancellationToken.None));
        Assert.Equal(1, gateway.CallCount); // AI returned HTTP-success-equivalent output.
        Assert.Contains(gateway.Request!.Cues, cue => cue.StartMs == 65_000 && cue.EndMs == 66_000);

        var persistedJob = await db.Set<ProcessingJobEntity>().SingleAsync();
        var package = (await service.GetAsync(started.Session.SessionId, CancellationToken.None)).Package!;
        Assert.Equal(expectedReady ? "ready" : "failed", package.QuizStatus);
        if (!expectedReady)
        {
            Assert.Equal("invalidAiOutput", persistedJob.LastErrorCode);
            Assert.Equal("failed", persistedJob.Status);
            Assert.Equal("quizGenerate", package.Error?.Operation);
            Assert.Null(package.Quiz);
            Assert.Empty(await db.Set<QuizAssessmentEntity>().ToArrayAsync());
            Assert.Contains(diagnosticLog.Entries, entry => entry.Contains(
                sourceEndMs > 120_000 ? "timestampOutOfRange" : "evidenceBoundary"));
            Assert.DoesNotContain(diagnosticLog.Entries, entry => entry.Contains("The first caption supplies the answer."));
        }
        else
        {
            Assert.Equal("succeeded", persistedJob.Status);
            Assert.Null(package.Error);
            Assert.Single(package.Quiz!.Questions);
            Assert.Single(await db.Set<QuizAssessmentEntity>().ToArrayAsync());
            Assert.Empty(diagnosticLog.Entries);
        }
    }

    [Theory]
    [InlineData("invalidAiOutput")]
    [InlineData("invalidAiOutputTimestamp")]
    public async Task OldFailedQuiz_OffersOnlyManualRetry_AndReusesTheSameJob(string errorCode)
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();

        var service = new LearningPackageService(db);
        var started = (await service.StartAsync(new StartLearningSessionCommand(
            "0.7.0", Guid.NewGuid().ToString(), $"session:manual-retry:{errorCode}",
            "2b5YsAvWyWU", "Caption overlap", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.7.0", $"transcript:manual-retry:{errorCode}",
                "2b5YsAvWyWU", "vi", "youtubeCaption", "available", null, 120_000,
                [new TranscriptCueView(65_000, 66_000, "The first caption."),
                 new TranscriptCueView(65_000, 70_000, "The extended caption.")]), CancellationToken.None);

        var gateway = new FirstFailureQuestionGateway(errorCode);
        using var provider = new ServiceCollection()
            .AddSingleton(db)
            .AddSingleton<IFullVideoQuestionGenerationGateway>(gateway)
            .AddSingleton<IConfiguration>(new ConfigurationBuilder().Build())
            .BuildServiceProvider();
        var worker = new LearningPackageWorker(provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<LearningPackageWorker>.Instance);

        Assert.True(await worker.ProcessNextAsync(CancellationToken.None));
        Assert.False(await worker.ProcessNextAsync(CancellationToken.None));
        Assert.Equal(1, gateway.CallCount);
        var failed = (await service.GetAsync(started.Session.SessionId, CancellationToken.None)).Package!;
        Assert.Equal("failed", failed.QuizStatus);
        Assert.True(failed.Error?.Retryable); // Also projects old rows persisted with retryable=false.
        Assert.Null(failed.Quiz);
        var job = await db.Set<ProcessingJobEntity>().SingleAsync();
        Assert.False(job.LastErrorRetryable);
        var jobId = job.ProcessingJobId;
        var idempotencyKey = job.IdempotencyKey;

        var retried = await service.RetryAsync(started.Session.SessionId, "0.7.0", "quizGenerate", CancellationToken.None);
        Assert.Equal("queued", retried.Package!.QuizStatus);
        Assert.Equal(jobId, (await db.Set<ProcessingJobEntity>().SingleAsync()).ProcessingJobId);
        Assert.Equal(idempotencyKey, (await db.Set<ProcessingJobEntity>().SingleAsync()).IdempotencyKey);
        Assert.True(await worker.ProcessNextAsync(CancellationToken.None));

        var ready = (await service.GetAsync(started.Session.SessionId, CancellationToken.None)).Package!;
        Assert.Equal("ready", ready.QuizStatus);
        Assert.Single(ready.Quiz!.Questions);
        Assert.Single(await db.Set<QuizAssessmentEntity>().ToArrayAsync());
        Assert.Single(await db.Set<StudyLens.Api.Features.VideoActivation.Infrastructure.TranscriptCaptureEntity>().ToArrayAsync());
        Assert.Equal(2, gateway.CallCount);
    }

    private sealed class ExactCueQuestionGateway(long sourceStartMs, long sourceEndMs) : IFullVideoQuestionGenerationGateway
    {
        public int CallCount { get; private set; }
        public FullVideoQuestionGenerationRequest? Request { get; private set; }

        public Task<AiGatewayResult<FullVideoQuestionGenerationResponse>> GenerateAsync(
            FullVideoQuestionGenerationRequest request, CancellationToken cancellationToken)
        {
            CallCount++;
            Request = request;
            return Task.FromResult(AiGatewayResult<FullVideoQuestionGenerationResponse>.Success(
                new FullVideoQuestionGenerationResponse("0.5.0", LearningPackageWorker.QuestionPromptVersion,
                [new FullVideoGeneratedQuestion("multipleChoice", "What does the first caption say?",
                    [new FullVideoGeneratedOption("a", "The first caption."),
                     new FullVideoGeneratedOption("b", "Something else.")],
                    "a", null, "The first caption supplies the answer.", sourceStartMs, sourceEndMs)])));
        }
    }

    private sealed class FirstFailureQuestionGateway(string errorCode) : IFullVideoQuestionGenerationGateway
    {
        public int CallCount { get; private set; }

        public Task<AiGatewayResult<FullVideoQuestionGenerationResponse>> GenerateAsync(
            FullVideoQuestionGenerationRequest request, CancellationToken cancellationToken)
        {
            CallCount++;
            if (CallCount == 1)
                return Task.FromResult(AiGatewayResult<FullVideoQuestionGenerationResponse>.Failure(
                    errorCode, "The evidence timestamp was invalid.", false));
            return new ExactCueQuestionGateway(65_000, 66_000).GenerateAsync(request, cancellationToken);
        }
    }

    private sealed class RecordingLogger : ILogger<LearningPackageWorker>
    {
        public List<string> Entries { get; } = [];

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;
        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Warning;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
            Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (IsEnabled(logLevel)) Entries.Add(formatter(state, exception));
        }

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();
            public void Dispose() { }
        }
    }
}
