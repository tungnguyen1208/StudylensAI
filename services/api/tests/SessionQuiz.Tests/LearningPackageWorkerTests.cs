using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Features.VideoActivation.Infrastructure;
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

    [Fact]
    public void VideoTitleForAi_IsWhitespaceNormalizedAndBounded()
    {
        Assert.Equal("Manage time before it is too late",
            LearningPackageWorker.NormalizeVideoTitleForAi("  Manage   time\tbefore it is too late  "));
        Assert.Equal(512, LearningPackageWorker.NormalizeVideoTitleForAi(new string('x', 513)).Length);
    }

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
            "0.7.0", Guid.NewGuid().ToString(), "session:binary-search", "RD53wLkH3mQ",
            "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        TranscriptCueView[] cues = [new(0, 4_500, "Introduction"), new(expectedEndMs - 5_000, expectedEndMs, "Final caption")];
        var submitted = await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.7.0", "transcript:binary-search", "RD53wLkH3mQ",
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
        Assert.Equal("Binary search", request.VideoTitle);
        Assert.Equal(LearningPackageWorker.QuestionPromptVersion, request.PromptVersion);
        Assert.All(request.Cues, cue => Assert.InRange(cue.EndMs, request.StartMs + 1, request.EndMs));
    }

    [Theory]
    [InlineData(1, 1)]
    [InlineData(5, 5)]
    public async Task QuizGeneration_PublishesOnlyAvailableQuestionsUpToDurationTarget(int generatedCount, int expectedCount)
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();

        var service = new LearningPackageService(db);
        var started = (await service.StartAsync(new StartLearningSessionCommand(
            "0.7.0", Guid.NewGuid().ToString(), "session:quiz-count", "RD53wLkH3mQ",
            "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.7.0", "transcript:quiz-count", "RD53wLkH3mQ",
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

    [Theory]
    [InlineData("contractVersion", "invalidAiResponse")]
    [InlineData("promptVersion", "invalidAiResponse")]
    [InlineData("invalidTrailingQuestion", "invalidAiOutput")]
    [InlineData("duplicatePrompt", "invalidAiOutput")]
    [InlineData("duplicateOptionId", "invalidAiOutput")]
    [InlineData("duplicateOptionText", "invalidAiOutput")]
    [InlineData("ungroundedTimestamp", "invalidAiOutput")]
    [InlineData("overTarget", "invalidAiOutput")]
    [InlineData("nullQuestion", "invalidAiOutput")]
    [InlineData("nullOption", "invalidAiOutput")]
    public async Task QuizGeneration_RejectsTheWholeInvalidResponse(string fault, string expectedCode)
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        var service = new LearningPackageService(db);
        var started = (await service.StartAsync(new StartLearningSessionCommand(
            "0.7.0", Guid.NewGuid().ToString(), $"session:invalid-{fault}", "RD53wLkH3mQ",
            "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.7.0", $"transcript:invalid-{fault}", "RD53wLkH3mQ",
                "vi", "youtubeCaption", "available", null, 600_000,
                [new TranscriptCueView(0, 10_000, "Binary search requires sorted input.")]), CancellationToken.None);

        var session = await db.Set<StudySessionEntity>().SingleAsync();
        var job = await db.Set<ProcessingJobEntity>().SingleAsync();
        using var provider = new ServiceCollection()
            .AddSingleton<IFullVideoQuestionGenerationGateway>(new FaultyQuestionGateway(fault))
            .AddSingleton<IConfiguration>(new ConfigurationBuilder().Build())
            .BuildServiceProvider();

        var outcome = await LearningPackageWorker.GenerateQuizAsync(provider, db, session, job, CancellationToken.None);

        Assert.False(outcome.Succeeded);
        Assert.Equal(expectedCode, outcome.Code);
        Assert.Equal("queued", session.QuizStatus);
        Assert.Null(session.QuizId);
        Assert.Empty(db.Set<QuizAssessmentEntity>().Local);
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
            "0.7.0", Guid.NewGuid().ToString(), "session:retry-quiz", "RD53wLkH3mQ",
            "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.7.0", "transcript:retry-quiz", "RD53wLkH3mQ",
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
            new CompleteLearningSessionCommand("0.7.0", Guid.NewGuid().ToString(), "videoEnded"), CancellationToken.None);
        Assert.Equal("failed", ended.Package!.Session.Status);

        var failedJob = await db.Set<ProcessingJobEntity>().SingleAsync();
        var retry = await service.RetryAsync(started.Session.SessionId, "0.7.0", "quizGenerate", CancellationToken.None);
        var replayedRetry = await service.RetryAsync(started.Session.SessionId, "0.7.0", "quizGenerate", CancellationToken.None);
        Assert.Equal("active", retry.Package!.Session.Status);
        Assert.Equal(retry.Package.Session.SessionId, replayedRetry.Package!.Session.SessionId);
        var requeuedJob = await db.Set<ProcessingJobEntity>().SingleAsync();
        Assert.Equal(failedJob.ProcessingJobId, requeuedJob.ProcessingJobId);
        Assert.Equal(failedJob.IdempotencyKey, requeuedJob.IdempotencyKey);
        Assert.Equal("queued", requeuedJob.Status);
        Assert.Equal(0, requeuedJob.AttemptCount);
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
            "0.7.0", Guid.NewGuid().ToString(), "session:missing-captions", "RD53wLkH3mQ",
            "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.7.0", "transcript:missing-captions", "RD53wLkH3mQ",
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
    public async Task GeneratedTranscript_UsesKnownPlayerDurationForQuestionTarget_WithoutClippingEvidenceRange()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        var service = new LearningPackageService(db);
        var started = (await service.StartAsync(new StartLearningSessionCommand(
            "0.7.0", Guid.NewGuid().ToString(), "session:fallback-duration", "2b5YsAvWyWU",
            "Claude skills", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.7.0", "transcript:fallback-duration", "2b5YsAvWyWU",
                "und", "youtubeCaption", "unavailable", null, 577_000, []), CancellationToken.None);

        var questionGateway = new CapturingQuestionGateway();
        using var provider = new ServiceCollection()
            .AddSingleton(db)
            .AddSingleton<ITranscriptGenerationGateway>(new SuccessfulTranscriptGateway())
            .AddSingleton<IFullVideoQuestionGenerationGateway>(questionGateway)
            .BuildServiceProvider();
        var worker = new LearningPackageWorker(provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<LearningPackageWorker>.Instance);

        Assert.True(await worker.ProcessNextAsync(CancellationToken.None));
        var capture = await db.Set<TranscriptCaptureEntity>().SingleAsync();
        var video = await db.Set<StudyVideoEntity>().SingleAsync();
        Assert.Equal(577_000, capture.DurationMs);
        Assert.Equal(577_000, video.DurationMs);

        var session = await db.Set<StudySessionEntity>().SingleAsync();
        var quizJob = await db.Set<ProcessingJobEntity>().SingleAsync(item => item.JobType == "quizGenerate");
        var outcome = await LearningPackageWorker.GenerateQuizAsync(provider, db, session, quizJob, CancellationToken.None);

        Assert.Equal("testStop", outcome.Code);
        Assert.Equal(3, questionGateway.Request!.QuestionCount);
        Assert.Equal(577_000, questionGateway.Request.EndMs);
        Assert.All(questionGateway.Request.Cues, cue => Assert.InRange(cue.EndMs, 1, 577_000));
    }

    [Fact]
    public async Task RestartRecovery_RequeuesRunningJobWithoutLosingState_AndPublishesAtMostOneQuiz()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite(connection).Options;
        string sessionId;
        string jobId;
        var recoveredAt = DateTimeOffset.UtcNow.AddMinutes(1);

        await using (var setup = new StudyLensDbContext(options))
        {
            await setup.Database.EnsureCreatedAsync();
            var service = new LearningPackageService(setup);
            var started = (await service.StartAsync(new StartLearningSessionCommand(
                "0.7.0", Guid.NewGuid().ToString(), "session:restart-recovery", "RD53wLkH3mQ",
                "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
            sessionId = started.Session.SessionId;
            await service.SubmitTranscriptAsync(sessionId,
                new SubmitFullTranscriptCommand("0.7.0", "transcript:restart-recovery", "RD53wLkH3mQ",
                    "vi", "youtubeCaption", "available", null, 600_000,
                    [new TranscriptCueView(0, 10_000, "Binary search requires sorted input.")]), CancellationToken.None);

            var running = await setup.Set<ProcessingJobEntity>().SingleAsync();
            jobId = running.ProcessingJobId;
            running.Status = "running";
            running.AttemptCount = 1;
            running.LastErrorCode = "providerTimeout";
            running.LastErrorMessage = "Previous attempt timed out.";
            running.LastErrorRetryable = true;
            await setup.SaveChangesAsync();
        }

        await using var restarted = new StudyLensDbContext(options);
        Assert.Equal(1, await LearningPackageWorker.RecoverRunningJobsAsync(
            restarted, recoveredAt, CancellationToken.None));
        var recovered = await restarted.Set<ProcessingJobEntity>().SingleAsync();
        Assert.Equal(jobId, recovered.ProcessingJobId);
        Assert.Equal("queued", recovered.Status);
        Assert.Equal(1, recovered.AttemptCount);
        Assert.Equal("providerTimeout", recovered.LastErrorCode);
        Assert.Equal("Previous attempt timed out.", recovered.LastErrorMessage);
        Assert.True(recovered.LastErrorRetryable);
        Assert.Equal(recoveredAt, recovered.UpdatedAtUtc);

        using var provider = new ServiceCollection()
            .AddSingleton(restarted)
            .AddSingleton<IFullVideoQuestionGenerationGateway>(new ReturningQuestionGateway(3))
            .AddSingleton<IConfiguration>(new ConfigurationBuilder().Build())
            .BuildServiceProvider();
        var worker = new LearningPackageWorker(provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<LearningPackageWorker>.Instance);

        Assert.True(await worker.ProcessNextAsync(CancellationToken.None));
        Assert.False(await worker.ProcessNextAsync(CancellationToken.None));
        Assert.Single(await restarted.Set<QuizAssessmentEntity>().ToArrayAsync());
        Assert.Equal("succeeded", (await restarted.Set<ProcessingJobEntity>().SingleAsync()).Status);
        Assert.Equal("ready", (await restarted.Set<StudySessionEntity>()
            .SingleAsync(item => item.SessionId == sessionId)).QuizStatus);
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
            "0.7.0", Guid.NewGuid().ToString(), "session:late-result", "RD53wLkH3mQ",
            "Binary search", "multipleChoice", "medium"), CancellationToken.None)).Package!;
        await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.7.0", "transcript:late-result", "RD53wLkH3mQ",
                "vi", "youtubeCaption", "available", null, 600_000,
                [new TranscriptCueView(0, 10_000, "Binary search requires sorted input.")]), CancellationToken.None);

        var gateway = new ClosingQuestionGateway(async () =>
        {
            await using var closingDb = new StudyLensDbContext(options);
            var closed = await new LearningPackageService(closingDb).CompleteAsync(started.Session.SessionId,
                new CompleteLearningSessionCommand("0.7.0", Guid.NewGuid().ToString(), "videoContextChanged"),
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
                new FullVideoQuestionGenerationResponse("0.5.0", LearningPackageWorker.QuestionPromptVersion, questions)));
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
                new FullVideoQuestionGenerationResponse("0.5.0", LearningPackageWorker.QuestionPromptVersion,
                [new FullVideoGeneratedQuestion("multipleChoice", "What does binary search require?",
                    [new FullVideoGeneratedOption("a", "Sorted input"), new FullVideoGeneratedOption("b", "Unsorted input")],
                    "a", null, "The video explains sorted input.", 0, 10_000)])));
        }
    }

    private sealed class FaultyQuestionGateway(string fault) : IFullVideoQuestionGenerationGateway
    {
        public Task<AiGatewayResult<FullVideoQuestionGenerationResponse>> GenerateAsync(
            FullVideoQuestionGenerationRequest request, CancellationToken cancellationToken)
        {
            var options = new[]
            {
                new FullVideoGeneratedOption("a", "Sorted input"),
                new FullVideoGeneratedOption("b", "Unsorted input"),
            };
            var first = new FullVideoGeneratedQuestion(
                "multipleChoice", "What does binary search require?", options,
                "a", null, "The cue states the prerequisite.", 0, 10_000);
            var second = new FullVideoGeneratedQuestion(
                "multipleChoice", "Why is sorted input required?", options,
                "a", null, "The cue states the prerequisite.", 0, 10_000);
            var questions = new List<FullVideoGeneratedQuestion> { first };
            var contractVersion = "0.5.0";
            var promptVersion = LearningPackageWorker.QuestionPromptVersion;

            switch (fault)
            {
                case "contractVersion":
                    contractVersion = "0.4.0";
                    break;
                case "promptVersion":
                    promptVersion = "0.4.0";
                    break;
                case "invalidTrailingQuestion":
                    questions.Add(second with { Type = "shortAnswer", ReferenceAnswer = null });
                    break;
                case "duplicatePrompt":
                    questions.Add(second with { Prompt = "  WHAT does   binary search require? " });
                    break;
                case "duplicateOptionId":
                    questions[0] = first with
                    {
                        Options = [new FullVideoGeneratedOption("a", "Sorted input"), new FullVideoGeneratedOption("a", "Other")],
                    };
                    break;
                case "duplicateOptionText":
                    questions[0] = first with
                    {
                        Options = [new FullVideoGeneratedOption("a", "Sorted   input"), new FullVideoGeneratedOption("b", " sorted input ")],
                    };
                    break;
                case "ungroundedTimestamp":
                    questions[0] = first with { SourceStartMs = 1_000, SourceEndMs = 9_000 };
                    break;
                case "overTarget":
                    questions = Enumerable.Range(1, 6).Select(index => first with { Prompt = $"Question {index}" }).ToList();
                    break;
                case "nullQuestion":
                    questions.Add(null!);
                    break;
                case "nullOption":
                    questions[0] = first with
                    {
                        Options = [null!, new FullVideoGeneratedOption("b", "Unsorted input")],
                    };
                    break;
            }

            return Task.FromResult(AiGatewayResult<FullVideoQuestionGenerationResponse>.Success(
                new FullVideoQuestionGenerationResponse(contractVersion, promptVersion, questions)));
        }
    }

    private sealed class FailedTranscriptGateway : ITranscriptGenerationGateway
    {
        public Task<AiGatewayResult<TranscriptGenerationResponse>> GenerateAsync(
            TranscriptGenerationRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(AiGatewayResult<TranscriptGenerationResponse>.Failure(
                "videoUnavailable", "The public video is unavailable.", false));
    }

    private sealed class SuccessfulTranscriptGateway : ITranscriptGenerationGateway
    {
        public Task<AiGatewayResult<TranscriptGenerationResponse>> GenerateAsync(
            TranscriptGenerationRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(AiGatewayResult<TranscriptGenerationResponse>.Success(
                new TranscriptGenerationResponse("0.5.0", request.YoutubeVideoId, "geminiVideo", "vi", 797_372,
                    [new TranscriptCueView(0, 10_000, "The main topic starts here."),
                     new TranscriptCueView(787_372, 797_372, "The final evidence is here.")])));
    }

    private sealed class ClosingQuestionGateway(Func<Task> closeSession) : IFullVideoQuestionGenerationGateway
    {
        public async Task<AiGatewayResult<FullVideoQuestionGenerationResponse>> GenerateAsync(
            FullVideoQuestionGenerationRequest request, CancellationToken cancellationToken)
        {
            await closeSession();
            return AiGatewayResult<FullVideoQuestionGenerationResponse>.Success(
                new FullVideoQuestionGenerationResponse("0.5.0", LearningPackageWorker.QuestionPromptVersion,
                [new FullVideoGeneratedQuestion("multipleChoice", "What does binary search require?",
                    [new FullVideoGeneratedOption("a", "Sorted input"), new FullVideoGeneratedOption("b", "Unsorted input")],
                    "a", null, "The video explains sorted input.", 0, 10_000)]));
        }
    }
}
