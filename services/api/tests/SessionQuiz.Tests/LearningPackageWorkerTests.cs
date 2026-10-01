using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;
using Xunit;

namespace SessionQuiz.Tests;

public sealed class LearningPackageWorkerTests
{
    [Theory]
    [InlineData(599_999L, 3)]
    [InlineData(600_000L, 5)]
    [InlineData(899_999L, 5)]
    [InlineData(900_000L, 5)]
    [InlineData(1_799_999L, 5)]
    [InlineData(1_800_000L, 10)]
    [InlineData(3_599_999L, 10)]
    [InlineData(3_600_000L, 15)]
    [InlineData(7_200_000L, 15)]
    public void QuestionCount_UsesVideoDurationBands(long durationMs, int expected) =>
        Assert.Equal(expected, LearningPackageWorker.QuestionCountForDuration(durationMs));

    [Theory]
    [InlineData("providerRateLimited", true, 1, 3, true)]
    [InlineData("providerFailed", true, 1, 3, false)]
    [InlineData("providerFailed", true, 3, 3, true)]
    [InlineData("providerBlockedContent", false, 1, 3, true)]
    public void AutomaticRetry_StopsOnQuotaWithoutLosingManualRetry(
        string code, bool retryable, int attemptCount, int maxAttempts, bool expected)
    {
        var outcome = AiJobOutcome.Fail(code, "Provider error", retryable);

        Assert.Equal(expected, LearningPackageWorker.ShouldStopAutomaticRetries(outcome, attemptCount, maxAttempts));
        if (code == "providerRateLimited") Assert.True(outcome.Retryable);
    }

    [Theory]
    [InlineData(872_901L, 877_000L, 5)]
    [InlineData(900_000L, 900_000L, 5)]
    [InlineData(1_799_999L, 1_800_050L, 5)]
    [InlineData(null, 877_000L, 5)]
    public async Task QuizRequestRange_ContainsEveryCue_WhenCaptionEndDiffersFromPlayerDuration(
        long? playerDurationMs, long expectedEndMs, int expectedQuestionCount)
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();

        var service = new LearningPackageService(db);
        var started = (await service.StartAsync(new StartLearningSessionCommand(
            "0.5.0", Guid.NewGuid().ToString(), "session:binary-search", "RD53wLkH3mQ",
            "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        TranscriptCueView[] cues = [new(0, 4_500, "Introduction"), new(expectedEndMs - 5_000, expectedEndMs, "Final caption")];
        var submitted = await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.5.0", "transcript:binary-search", "RD53wLkH3mQ",
                "vi", "youtubeCaption", "available", null, playerDurationMs, cues), CancellationToken.None);
        Assert.Equal("queued", submitted.Package!.QuizStatus);

        var session = await db.Set<StudySessionEntity>().SingleAsync();
        var job = await db.Set<ProcessingJobEntity>().SingleAsync();
        var gateway = new CapturingQuestionGateway();
        using var provider = new ServiceCollection()
            .AddSingleton<IFullVideoQuestionGenerationGateway>(gateway)
            .BuildServiceProvider();

        var outcome = await LearningPackageWorker.GenerateQuizAsync(provider, db, session, job, CancellationToken.None);

        Assert.Equal("testStop", outcome.Code);
        var request = Assert.IsType<FullVideoQuestionGenerationRequest>(gateway.Request);
        Assert.Equal(0, request.StartMs);
        Assert.Equal(expectedEndMs, request.EndMs);
        Assert.Equal(expectedQuestionCount, request.QuestionCount);
        Assert.All(request.Cues, cue => Assert.InRange(cue.EndMs, request.StartMs + 1, request.EndMs));
    }

    [Theory]
    [InlineData(1, 1)]
    [InlineData(7, 5)]
    public async Task QuizGeneration_PublishesOnlyAvailableQuestionsUpToDurationTarget(int generatedCount, int expectedCount)
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();

        var service = new LearningPackageService(db);
        var started = (await service.StartAsync(new StartLearningSessionCommand(
            "0.5.0", Guid.NewGuid().ToString(), "session:quiz-count", "RD53wLkH3mQ",
            "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.5.0", "transcript:quiz-count", "RD53wLkH3mQ",
                "vi", "youtubeCaption", "available", null, 900_000,
                [new TranscriptCueView(0, 10_000, "Binary search requires sorted input.")]), CancellationToken.None);

        var session = await db.Set<StudySessionEntity>().SingleAsync();
        var job = await db.Set<ProcessingJobEntity>().SingleAsync();
        using var provider = new ServiceCollection()
            .AddSingleton<IFullVideoQuestionGenerationGateway>(new ReturningQuestionGateway(generatedCount))
            .AddSingleton<IConfiguration>(new ConfigurationBuilder().Build())
            .BuildServiceProvider();

        var outcome = await LearningPackageWorker.GenerateQuizAsync(provider, db, session, job, CancellationToken.None);

        Assert.True(outcome.Succeeded);
        Assert.Equal("ready", session.QuizStatus);
        Assert.Equal(expectedCount, db.Set<QuizAssessmentEntity>().Local.Single().Questions.Count);
    }

    [Fact]
    public async Task FailedQuiz_LeavesRetryableSessionWithoutQuiz_ThenRetryPublishesOneQuiz()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        var service = new LearningPackageService(db);
        var started = (await service.StartAsync(new StartLearningSessionCommand(
            "0.5.0", Guid.NewGuid().ToString(), "session:retry-quiz", "RD53wLkH3mQ",
            "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.5.0", "transcript:retry-quiz", "RD53wLkH3mQ",
                "vi", "youtubeCaption", "available", null, 600_000,
                [new TranscriptCueView(0, 10_000, "Binary search requires sorted input.")]), CancellationToken.None);

        var gateway = new FailThenSucceedQuestionGateway();
        using var provider = new ServiceCollection()
            .AddSingleton(db)
            .AddSingleton<IFullVideoQuestionGenerationGateway>(gateway)
            .AddSingleton<IConfiguration>(new ConfigurationBuilder().Build())
            .BuildServiceProvider();
        var worker = new LearningPackageWorker(provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<LearningPackageWorker>.Instance);

        Assert.True(await worker.ProcessNextAsync(CancellationToken.None));
        var failed = (await service.GetAsync(started.Session.SessionId, CancellationToken.None)).Package!;
        Assert.Equal("failed", failed.Session.Status);
        Assert.Equal("failed", failed.QuizStatus);
        Assert.Null(failed.Quiz);
        Assert.Equal("quizGenerate", failed.Error?.Operation);
        Assert.Empty(await db.Set<QuizAssessmentEntity>().ToArrayAsync());
        Assert.Single(await db.Set<StudyLens.Api.Features.VideoActivation.Infrastructure.TranscriptCaptureEntity>().ToArrayAsync());

        var ended = await service.CompleteAsync(started.Session.SessionId,
            new CompleteLearningSessionCommand("0.5.0", Guid.NewGuid().ToString(), "videoEnded"), CancellationToken.None);
        Assert.Equal("failed", ended.Package!.Session.Status);

        var retry = await service.RetryAsync(started.Session.SessionId, "0.5.0", "quizGenerate", CancellationToken.None);
        Assert.Equal("active", retry.Package!.Session.Status);
        Assert.True(await worker.ProcessNextAsync(CancellationToken.None));
        var ready = (await service.GetAsync(started.Session.SessionId, CancellationToken.None)).Package!;
        Assert.Equal("ready", ready.QuizStatus);
        Assert.Equal("RD53wLkH3mQ", ready.Quiz!.Questions[0].Source.YoutubeVideoId);
        Assert.Single(await db.Set<QuizAssessmentEntity>().ToArrayAsync());
    }

    [Fact]
    public async Task FailedTranscript_KeepsOnlyFailureStateAndNoCaptureOrQuiz()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        var service = new LearningPackageService(db);
        var started = (await service.StartAsync(new StartLearningSessionCommand(
            "0.5.0", Guid.NewGuid().ToString(), "session:missing-captions", "RD53wLkH3mQ",
            "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.5.0", "transcript:missing-captions", "RD53wLkH3mQ",
                "und", "youtubeCaption", "unavailable", null, null, []), CancellationToken.None);

        using var provider = new ServiceCollection()
            .AddSingleton(db)
            .AddSingleton<ITranscriptGenerationGateway>(new FailedTranscriptGateway())
            .BuildServiceProvider();
        var worker = new LearningPackageWorker(provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<LearningPackageWorker>.Instance);

        Assert.True(await worker.ProcessNextAsync(CancellationToken.None));
        var failed = (await service.GetAsync(started.Session.SessionId, CancellationToken.None)).Package!;
        Assert.Equal("failed", failed.Session.Status);
        Assert.Equal("unavailable", failed.Transcript.Status);
        Assert.Equal("transcriptGenerate", failed.Error?.Operation);
        Assert.Empty(await db.Set<StudyLens.Api.Features.VideoActivation.Infrastructure.TranscriptCaptureEntity>().ToArrayAsync());
        Assert.Empty(await db.Set<QuizAssessmentEntity>().ToArrayAsync());
    }

    [Fact]
    public async Task VideoClosedWhileAiIsGenerating_DiscardsLateQuizAndProvisionalTranscript()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite(connection).Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.EnsureCreatedAsync();
        var service = new LearningPackageService(db);
        var started = (await service.StartAsync(new StartLearningSessionCommand(
            "0.5.0", Guid.NewGuid().ToString(), "session:late-result", "RD53wLkH3mQ",
            "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.5.0", "transcript:late-result", "RD53wLkH3mQ",
                "vi", "youtubeCaption", "available", null, 600_000,
                [new TranscriptCueView(0, 10_000, "Binary search requires sorted input.")]), CancellationToken.None);

        var gateway = new ClosingQuestionGateway(async () =>
        {
            await using var closingDb = new StudyLensDbContext(options);
            var closed = await new LearningPackageService(closingDb).CompleteAsync(started.Session.SessionId,
                new CompleteLearningSessionCommand("0.5.0", Guid.NewGuid().ToString(), "videoContextChanged"),
                CancellationToken.None);
            Assert.Equal("closed", closed.Package!.Session.Status);
        });
        using var provider = new ServiceCollection()
            .AddSingleton(db)
            .AddSingleton<IFullVideoQuestionGenerationGateway>(gateway)
            .AddSingleton<IConfiguration>(new ConfigurationBuilder().Build())
            .BuildServiceProvider();
        var worker = new LearningPackageWorker(provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<LearningPackageWorker>.Instance);

        Assert.True(await worker.ProcessNextAsync(CancellationToken.None));
        Assert.Equal("closed", (await db.Set<StudySessionEntity>().SingleAsync()).Status);
        Assert.Empty(await db.Set<QuizAssessmentEntity>().ToArrayAsync());
        Assert.Empty(await db.Set<StudyLens.Api.Features.VideoActivation.Infrastructure.TranscriptCaptureEntity>().ToArrayAsync());
        Assert.All(await db.Set<ProcessingJobEntity>().ToArrayAsync(), job => Assert.Equal("cancelled", job.Status));
    }

    private sealed class CapturingQuestionGateway : IFullVideoQuestionGenerationGateway
    {
        public FullVideoQuestionGenerationRequest? Request { get; private set; }

        public Task<AiGatewayResult<FullVideoQuestionGenerationResponse>> GenerateAsync(
            FullVideoQuestionGenerationRequest request, CancellationToken cancellationToken)
        {
            Request = request;
            return Task.FromResult(AiGatewayResult<FullVideoQuestionGenerationResponse>.Failure(
                "testStop", "The test captured the request before contacting AI Service.", false));
        }
    }

    private sealed class ReturningQuestionGateway(int count) : IFullVideoQuestionGenerationGateway
    {
        public Task<AiGatewayResult<FullVideoQuestionGenerationResponse>> GenerateAsync(
            FullVideoQuestionGenerationRequest request, CancellationToken cancellationToken)
        {
            var questions = Enumerable.Range(1, count).Select(index => new FullVideoGeneratedQuestion(
                "multipleChoice", $"Question {index}",
                [new FullVideoGeneratedOption("a", "Yes"), new FullVideoGeneratedOption("b", "No")],
                "a", null, "Grounded in the transcript.", 0, 10_000)).ToArray();
            return Task.FromResult(AiGatewayResult<FullVideoQuestionGenerationResponse>.Success(
                new FullVideoQuestionGenerationResponse("0.5.0", "0.5.0", questions)));
        }
    }

    private sealed class FailThenSucceedQuestionGateway : IFullVideoQuestionGenerationGateway
    {
        private int calls;

        public Task<AiGatewayResult<FullVideoQuestionGenerationResponse>> GenerateAsync(
            FullVideoQuestionGenerationRequest request, CancellationToken cancellationToken)
        {
            calls++;
            if (calls == 1)
                return Task.FromResult(AiGatewayResult<FullVideoQuestionGenerationResponse>.Failure(
                    "invalidAiOutput", "The provider returned no usable questions.", false));
            return Task.FromResult(AiGatewayResult<FullVideoQuestionGenerationResponse>.Success(
                new FullVideoQuestionGenerationResponse("0.5.0", "0.5.0",
                [new FullVideoGeneratedQuestion("multipleChoice", "What does binary search require?",
                    [new FullVideoGeneratedOption("a", "Sorted input"), new FullVideoGeneratedOption("b", "Unsorted input")],
                    "a", null, "The video explains sorted input.", 0, 10_000)])));
        }
    }

    private sealed class FailedTranscriptGateway : ITranscriptGenerationGateway
    {
        public Task<AiGatewayResult<TranscriptGenerationResponse>> GenerateAsync(
            TranscriptGenerationRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(AiGatewayResult<TranscriptGenerationResponse>.Failure(
                "videoUnavailable", "The public video is unavailable.", false));
    }

    private sealed class ClosingQuestionGateway(Func<Task> closeSession) : IFullVideoQuestionGenerationGateway
    {
        public async Task<AiGatewayResult<FullVideoQuestionGenerationResponse>> GenerateAsync(
            FullVideoQuestionGenerationRequest request, CancellationToken cancellationToken)
        {
            await closeSession();
            return AiGatewayResult<FullVideoQuestionGenerationResponse>.Success(
                new FullVideoQuestionGenerationResponse("0.5.0", "0.5.0",
                [new FullVideoGeneratedQuestion("multipleChoice", "What does binary search require?",
                    [new FullVideoGeneratedOption("a", "Sorted input"), new FullVideoGeneratedOption("b", "Unsorted input")],
                    "a", null, "The video explains sorted input.", 0, 10_000)]));
        }
    }
}
