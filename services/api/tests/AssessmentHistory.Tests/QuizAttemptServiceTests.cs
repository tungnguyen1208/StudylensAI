using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.AssessmentHistory.Application;
using StudyLens.Api.Features.AssessmentHistory.Infrastructure;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;
using Xunit;

namespace AssessmentHistory.Tests;

public sealed class QuizAttemptServiceTests
{
    [Fact]
    public async Task SubmitAttempt_GradesAllQuestions_PersistsHistory_AndReplays()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        SeedQuiz(db);
        await db.SaveChangesAsync();
        var store = new SqliteQuestionAssessmentStore(db);
        var service = new AssessmentHistoryService(new AssessmentHistoryDbContext(db), store, new FakeShortAnswerGateway(), db);
        var command = new SubmitQuizAttemptCommand("0.7.0", "77777777-7777-4777-8777-777777777777", QuizId,
        [
            new SubmitAttemptAnswer(MultipleChoiceId, "option-a", null),
            new SubmitAttemptAnswer(ShortAnswerId, null, "IP routes packets."),
        ]);

        var first = await service.SubmitAttemptAsync(command, CancellationToken.None);
        var replay = await service.SubmitAttemptAsync(command, CancellationToken.None);
        var conflict = await service.SubmitAttemptAsync(command with
        {
            Answers =
            [
                new SubmitAttemptAnswer(MultipleChoiceId, "option-b", null),
                new SubmitAttemptAnswer(ShortAnswerId, null, "IP routes packets."),
            ],
        }, CancellationToken.None);
        var history = await service.ReadHistoryAsync("dQw4w9WgXcQ", CancellationToken.None);

        Assert.NotNull(first.Attempt);
        Assert.Equal(first.Attempt!.QuizAttemptId, replay.Attempt!.QuizAttemptId);
        Assert.Equal(StatusCodes.Status409Conflict, conflict.StatusCode);
        Assert.Equal("idempotencyConflict", conflict.ErrorCode);
        Assert.Equal(1, first.Attempt.Score);
        Assert.Equal(2, first.Attempt.Results.Count);
        Assert.Equal(2, history.Count);
        Assert.Equal(2, await db.Set<AttemptAnswerEntity>().CountAsync());
        Assert.All(history, item =>
        {
            Assert.Equal("dQw4w9WgXcQ", item.YoutubeVideoId);
            Assert.Equal("https://www.youtube.com/watch?v=dQw4w9WgXcQ", item.VideoUrl);
            Assert.Equal("Networking lesson", item.VideoTitle);
            Assert.Equal(first.Attempt.QuizAttemptId, item.QuizAttemptId);
            Assert.Equal(first.Attempt.Score, item.AttemptScore);
        });
        Assert.Equal("completed", (await db.Set<StudySessionEntity>().SingleAsync()).Status);
    }

    [Fact]
    public async Task SubmitAttempt_RequiresEveryQuestionExactlyOnce()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        SeedQuiz(db);
        await db.SaveChangesAsync();
        var store = new SqliteQuestionAssessmentStore(db);
        var service = new AssessmentHistoryService(new AssessmentHistoryDbContext(db), store, new FakeShortAnswerGateway(), db);

        var result = await service.SubmitAttemptAsync(new SubmitQuizAttemptCommand(
            "0.7.0", "88888888-8888-4888-8888-888888888888", QuizId,
            [new SubmitAttemptAnswer(MultipleChoiceId, "option-a", null)]), CancellationToken.None);

        Assert.Equal(StatusCodes.Status400BadRequest, result.StatusCode);
        Assert.Equal("incompleteAttempt", result.ErrorCode);
        Assert.Empty(await db.Set<QuizAttemptEntity>().ToArrayAsync());
    }

    [Fact]
    public async Task SubmitAttempt_RejectsFailedSessionWithoutSavingAnswers()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        SeedQuiz(db);
        await db.SaveChangesAsync();
        (await db.Set<StudySessionEntity>().SingleAsync()).Status = "failed";
        await db.SaveChangesAsync();
        var service = new AssessmentHistoryService(new AssessmentHistoryDbContext(db),
            new SqliteQuestionAssessmentStore(db), new FakeShortAnswerGateway(), db);

        var result = await service.SubmitAttemptAsync(new SubmitQuizAttemptCommand(
            "0.7.0", Guid.NewGuid().ToString(), QuizId,
            [new SubmitAttemptAnswer(MultipleChoiceId, "option-a", null),
             new SubmitAttemptAnswer(ShortAnswerId, null, "IP routes packets.")]), CancellationToken.None);

        Assert.Equal("sessionNotReady", result.ErrorCode);
        Assert.Empty(await db.Set<QuizAttemptEntity>().ToArrayAsync());
        Assert.Empty(await db.Set<AttemptAnswerEntity>().ToArrayAsync());
    }

    [Fact]
    public async Task SubmitAttempt_ProviderFailureWritesNothing_AndSameAttemptCanRetry()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        SeedQuiz(db);
        await db.SaveChangesAsync();
        var gateway = new MutableShortAnswerGateway { Fail = true };
        var service = new AssessmentHistoryService(new AssessmentHistoryDbContext(db),
            new SqliteQuestionAssessmentStore(db), gateway, db);
        var command = new SubmitQuizAttemptCommand(
            "0.7.0", "99999999-9999-4999-8999-999999999999", QuizId,
            [new SubmitAttemptAnswer(MultipleChoiceId, "option-a", null),
             new SubmitAttemptAnswer(ShortAnswerId, null, "IP routes packets.")]);

        var failed = await service.SubmitAttemptAsync(command, CancellationToken.None);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, failed.StatusCode);
        Assert.Equal("providerRateLimited", failed.ErrorCode);
        Assert.True(failed.Retryable);
        Assert.Empty(await db.Set<QuizAttemptEntity>().ToArrayAsync());
        Assert.Empty(await db.Set<AttemptAnswerEntity>().ToArrayAsync());
        Assert.Equal("active", (await db.Set<StudySessionEntity>().SingleAsync()).Status);

        gateway.Fail = false;
        var retried = await service.SubmitAttemptAsync(command, CancellationToken.None);

        Assert.NotNull(retried.Attempt);
        Assert.Single(await db.Set<QuizAttemptEntity>().ToArrayAsync());
        Assert.Equal(2, await db.Set<AttemptAnswerEntity>().CountAsync());
        Assert.Equal("completed", (await db.Set<StudySessionEntity>().SingleAsync()).Status);
    }

    [Fact]
    public async Task SubmitAttempt_TwoContextsRace_ConvergesOnOnePersistedAttempt()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"studylens-attempt-race-{Guid.NewGuid()}.db");
        var options = new DbContextOptionsBuilder<StudyLensDbContext>()
            .UseSqlite($"Data Source={databasePath};Pooling=False")
            .Options;
        try
        {
            await using (var setup = new StudyLensDbContext(options))
            {
                await setup.Database.EnsureCreatedAsync();
                SeedQuiz(setup);
                await setup.SaveChangesAsync();
            }

            await using var firstDb = new StudyLensDbContext(options);
            await using var secondDb = new StudyLensDbContext(options);
            var gateway = new CoordinatedShortAnswerGateway(2);
            var firstService = new AssessmentHistoryService(new AssessmentHistoryDbContext(firstDb),
                new SqliteQuestionAssessmentStore(firstDb), gateway, firstDb);
            var secondService = new AssessmentHistoryService(new AssessmentHistoryDbContext(secondDb),
                new SqliteQuestionAssessmentStore(secondDb), gateway, secondDb);
            var command = new SubmitQuizAttemptCommand(
                "0.7.0", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", QuizId,
                [new SubmitAttemptAnswer(MultipleChoiceId, "option-a", null),
                 new SubmitAttemptAnswer(ShortAnswerId, null, "IP routes packets.")]);

            var results = await Task.WhenAll(
                firstService.SubmitAttemptAsync(command, CancellationToken.None),
                secondService.SubmitAttemptAsync(command, CancellationToken.None));

            Assert.All(results, result => Assert.NotNull(result.Attempt));
            Assert.Equal(results[0].Attempt!.QuizAttemptId, results[1].Attempt!.QuizAttemptId);
            await using var verification = new StudyLensDbContext(options);
            Assert.Single(await verification.Set<QuizAttemptEntity>().ToArrayAsync());
            Assert.Equal(2, await verification.Set<AttemptAnswerEntity>().CountAsync());
            Assert.Equal("completed", (await verification.Set<StudySessionEntity>().SingleAsync()).Status);
        }
        finally
        {
            if (File.Exists(databasePath)) File.Delete(databasePath);
        }
    }

    [Theory]
    [InlineData(-1, 5_000)]
    [InlineData(5_000, 5_000)]
    [InlineData(6_000, 5_000)]
    public async Task SubmitAttempt_InvalidEvidenceIsRejectedBeforeGradingOrPersistence(long startMs, long endMs)
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        SeedQuiz(db);
        await db.SaveChangesAsync();
        var question = await db.Set<QuestionAssessmentEntity>().SingleAsync(item => item.QuestionId == ShortAnswerId);
        question.SourceStartMs = startMs;
        question.SourceEndMs = endMs;
        await db.SaveChangesAsync();
        var gateway = new CountingShortAnswerGateway();
        var service = new AssessmentHistoryService(new AssessmentHistoryDbContext(db),
            new SqliteQuestionAssessmentStore(db), gateway, db);

        var result = await service.SubmitAttemptAsync(new SubmitQuizAttemptCommand(
            "0.7.0", Guid.NewGuid().ToString(), QuizId,
            [new SubmitAttemptAnswer(MultipleChoiceId, "option-a", null),
             new SubmitAttemptAnswer(ShortAnswerId, null, "IP routes packets.")]), CancellationToken.None);

        Assert.Equal(StatusCodes.Status400BadRequest, result.StatusCode);
        Assert.Equal("invalidEvidenceSource", result.ErrorCode);
        Assert.Equal(0, gateway.Calls);
        Assert.Empty(await db.Set<QuizAttemptEntity>().ToArrayAsync());
        Assert.Empty(await db.Set<AttemptAnswerEntity>().ToArrayAsync());
    }

    [Fact]
    public async Task SubmitAttempt_InvalidEvidenceVideoIdIsRejectedBeforeGradingOrPersistence()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        SeedQuiz(db);
        await db.SaveChangesAsync();
        var question = await db.Set<QuestionAssessmentEntity>().SingleAsync(item => item.QuestionId == ShortAnswerId);
        question.YoutubeVideoId = "invalid";
        await db.SaveChangesAsync();
        var gateway = new CountingShortAnswerGateway();
        var service = new AssessmentHistoryService(new AssessmentHistoryDbContext(db),
            new SqliteQuestionAssessmentStore(db), gateway, db);

        var result = await service.SubmitAttemptAsync(new SubmitQuizAttemptCommand(
            "0.7.0", Guid.NewGuid().ToString(), QuizId,
            [new SubmitAttemptAnswer(MultipleChoiceId, "option-a", null),
             new SubmitAttemptAnswer(ShortAnswerId, null, "IP routes packets.")]), CancellationToken.None);

        Assert.Equal(StatusCodes.Status400BadRequest, result.StatusCode);
        Assert.Equal("invalidEvidenceSource", result.ErrorCode);
        Assert.Equal(0, gateway.Calls);
        Assert.Empty(await db.Set<QuizAttemptEntity>().ToArrayAsync());
        Assert.Empty(await db.Set<AttemptAnswerEntity>().ToArrayAsync());
    }

    [Fact]
    public async Task HistoryLimit_NeverSplitsAWholeQuizAttempt_AndOrderingIsStable()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        SeedQuiz(db);
        var submittedAt = new DateTimeOffset(2026, 10, 2, 8, 0, 0, TimeSpan.Zero);
        for (var index = 0; index < 99; index++)
        {
            db.Add(new AnswerAttemptEntity
            {
                AnswerAttemptId = $"legacy-{index:D3}", ClientAttemptId = $"legacy-client-{index:D3}", QuizId = QuizId,
                SessionId = "33333333-3333-4333-8333-333333333333", QuestionId = $"legacy-question-{index:D3}",
                YoutubeVideoId = "dQw4w9WgXcQ", QuestionPrompt = "Legacy", QuestionType = "multipleChoice",
                SubmittedAnswer = "a", Outcome = "correct", Score = 1, ReferenceAnswer = "a", Explanation = "ok",
                SourceStartMs = 0, SourceEndMs = 1_000, GradedAtUtc = submittedAt,
            });
        }
        db.Add(new QuizAttemptEntity
        {
            QuizAttemptId = "batch-attempt", ClientAttemptId = "batch-client", QuizId = QuizId,
            SessionId = "33333333-3333-4333-8333-333333333333", Score = 1,
            SubmittedAtUtc = submittedAt.AddMinutes(-1), Answers =
            [
                BatchAnswer("batch-answer-a", MultipleChoiceId),
                BatchAnswer("batch-answer-b", ShortAnswerId),
            ],
        });
        await db.SaveChangesAsync();
        var service = new AssessmentHistoryService(new AssessmentHistoryDbContext(db),
            new SqliteQuestionAssessmentStore(db), new FakeShortAnswerGateway(), db);

        var first = await service.ReadHistoryAsync("dQw4w9WgXcQ", CancellationToken.None);
        var second = await service.ReadHistoryAsync("dQw4w9WgXcQ", CancellationToken.None);

        Assert.Equal(99, first.Count);
        Assert.All(first, item => Assert.Null(item.QuizAttemptId));
        Assert.Equal(first.Select(item => item.AnswerAttemptId), second.Select(item => item.AnswerAttemptId));
    }

    [Fact]
    public async Task History_MixedVideosAndAttempts_RecoversAfterRestart_AndCapsWholeGroupsAtOneHundred()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"studylens-history-restart-{Guid.NewGuid()}.db");
        var options = new DbContextOptionsBuilder<StudyLensDbContext>()
            .UseSqlite($"Data Source={databasePath};Pooling=False")
            .Options;
        var secondVideoId = "RD53wLkH3mQ";
        var secondSessionId = "44444444-4444-4444-8444-444444444444";
        try
        {
            await using (var setup = new StudyLensDbContext(options))
            {
                await setup.Database.EnsureCreatedAsync();
                SeedQuiz(setup);
                setup.Add(new StudyVideoEntity
                {
                    YoutubeVideoId = secondVideoId, Title = "Binary search lesson",
                    CreatedAtUtc = DateTimeOffset.UtcNow, LastSeenAtUtc = DateTimeOffset.UtcNow,
                });
                setup.Add(new StudySessionEntity
                {
                    SessionId = secondSessionId, ActivationId = Guid.NewGuid().ToString(),
                    StartIdempotencyKey = "session:history-second-video", YoutubeVideoId = secondVideoId,
                    VideoTitle = "Binary search lesson", Status = "completed", TranscriptStatus = "ready",
                    QuizStatus = "ready", StartedAtUtc = DateTimeOffset.UtcNow.AddHours(-1),
                });

                var newest = new DateTimeOffset(2026, 10, 2, 9, 0, 0, TimeSpan.Zero);
                setup.AddRange(
                    BatchAttempt("newest-attempt-a", "newest-client-a", "33333333-3333-4333-8333-333333333333",
                        "dQw4w9WgXcQ", newest),
                    BatchAttempt("newest-attempt-b", "newest-client-b", secondSessionId, secondVideoId, newest.AddSeconds(-1)));
                for (var index = 0; index < 101; index++)
                {
                    var secondVideo = index % 2 == 1;
                    setup.Add(new AnswerAttemptEntity
                    {
                        AnswerAttemptId = $"mixed-legacy-{index:D3}", ClientAttemptId = $"mixed-client-{index:D3}", QuizId = QuizId,
                        SessionId = secondVideo ? secondSessionId : "33333333-3333-4333-8333-333333333333",
                        QuestionId = $"mixed-question-{index:D3}", YoutubeVideoId = secondVideo ? secondVideoId : "dQw4w9WgXcQ",
                        QuestionPrompt = $"Legacy question {index}", QuestionType = "multipleChoice", SubmittedAnswer = "a",
                        Outcome = "correct", Score = 1, ReferenceAnswer = "a", Explanation = "Stored result",
                        SourceStartMs = index * 1_000L, SourceEndMs = index * 1_000L + 500,
                        GradedAtUtc = newest.AddMinutes(-1).AddSeconds(-index),
                    });
                }
                await setup.SaveChangesAsync();
            }

            await using var restarted = new StudyLensDbContext(options);
            var service = new AssessmentHistoryService(new AssessmentHistoryDbContext(restarted),
                new SqliteQuestionAssessmentStore(restarted), new FakeShortAnswerGateway(), restarted);
            var first = await service.ReadHistoryAsync(null, CancellationToken.None);
            var replay = await service.ReadHistoryAsync(null, CancellationToken.None);

            Assert.Equal(100, first.Count);
            Assert.Equal(first.Select(item => item.AnswerAttemptId), replay.Select(item => item.AnswerAttemptId));
            Assert.Equal(2, first.Count(item => item.QuizAttemptId == "newest-attempt-a"));
            Assert.Equal(2, first.Count(item => item.QuizAttemptId == "newest-attempt-b"));
            Assert.Contains(first, item => item.YoutubeVideoId == "dQw4w9WgXcQ" && item.VideoTitle == "Networking lesson");
            Assert.Contains(first, item => item.YoutubeVideoId == secondVideoId && item.VideoTitle == "Binary search lesson");
            Assert.All(first, item => Assert.Equal($"https://www.youtube.com/watch?v={item.YoutubeVideoId}", item.VideoUrl));
        }
        finally
        {
            if (File.Exists(databasePath)) File.Delete(databasePath);
        }
    }

    private static AttemptAnswerEntity BatchAnswer(string id, string questionId) => new()
    {
        AttemptAnswerId = id, QuestionId = questionId, YoutubeVideoId = "dQw4w9WgXcQ",
        QuestionPrompt = "Batch", QuestionType = "multipleChoice", SubmittedAnswer = "a", Outcome = "correct",
        Score = 1, ReferenceAnswer = "a", Explanation = "ok", SourceStartMs = 0, SourceEndMs = 1_000,
    };

    private static QuizAttemptEntity BatchAttempt(
        string attemptId, string clientAttemptId, string sessionId, string videoId, DateTimeOffset submittedAt) => new()
    {
        QuizAttemptId = attemptId, ClientAttemptId = clientAttemptId, QuizId = QuizId, SessionId = sessionId,
        Score = 1, SubmittedAtUtc = submittedAt,
        Answers =
        [
            BatchAnswerFor($"{attemptId}-a", MultipleChoiceId, videoId),
            BatchAnswerFor($"{attemptId}-b", ShortAnswerId, videoId),
        ],
    };

    private static AttemptAnswerEntity BatchAnswerFor(string id, string questionId, string videoId) => new()
    {
        AttemptAnswerId = id, QuestionId = questionId, YoutubeVideoId = videoId,
        QuestionPrompt = "Batch", QuestionType = "multipleChoice", SubmittedAnswer = "a", Outcome = "correct",
        Score = 1, ReferenceAnswer = "a", Explanation = "ok", SourceStartMs = 0, SourceEndMs = 1_000,
    };

    private static void SeedQuiz(StudyLensDbContext db)
    {
        db.Add(new StudyVideoEntity
        {
            YoutubeVideoId = "dQw4w9WgXcQ", Title = "Networking lesson", CreatedAtUtc = DateTimeOffset.UtcNow,
            LastSeenAtUtc = DateTimeOffset.UtcNow,
        });
        db.Add(new StudySessionEntity
        {
            SessionId = "33333333-3333-4333-8333-333333333333", ActivationId = Guid.NewGuid().ToString(),
            StartIdempotencyKey = "session:quiz-test", YoutubeVideoId = "dQw4w9WgXcQ", VideoTitle = "Networking lesson",
            Status = "active", TranscriptStatus = "ready", QuizStatus = "ready", QuizId = QuizId,
            StartedAtUtc = DateTimeOffset.UtcNow,
        });
        db.Add(new QuizAssessmentEntity
    {
        QuizId = QuizId,
        IdempotencyKey = "quiz:session:hash",
        SessionId = "33333333-3333-4333-8333-333333333333",
        SegmentId = string.Empty,
        YoutubeVideoId = "dQw4w9WgXcQ",
        Status = "ready",
        QuestionType = "mixed",
        Difficulty = "medium",
        CreatedAtUtc = DateTimeOffset.UtcNow,
        Questions =
        [
            new QuestionAssessmentEntity
            {
                QuestionId = MultipleChoiceId, QuizId = QuizId, Type = "multipleChoice", Prompt = "What routes packets?",
                CorrectOptionId = "option-a", Explanation = "The transcript identifies IP.", YoutubeVideoId = "dQw4w9WgXcQ",
                SourceStartMs = 0, SourceEndMs = 5_000,
                Options =
                [
                    new QuestionOptionEntity { QuestionOptionId = Guid.NewGuid().ToString(), QuestionId = MultipleChoiceId, OptionId = "option-a", Text = "IP", Position = 0 },
                    new QuestionOptionEntity { QuestionOptionId = Guid.NewGuid().ToString(), QuestionId = MultipleChoiceId, OptionId = "option-b", Text = "HTML", Position = 1 },
                ],
            },
            new QuestionAssessmentEntity
            {
                QuestionId = ShortAnswerId, QuizId = QuizId, Type = "shortAnswer", Prompt = "What does IP do?",
                ReferenceAnswer = "IP routes packets.", Explanation = "The transcript explains packet routing.", YoutubeVideoId = "dQw4w9WgXcQ",
                SourceStartMs = 5_000, SourceEndMs = 10_000,
            },
        ],
    });
    }

    private const string QuizId = "11111111-1111-4111-8111-111111111111";
    private const string MultipleChoiceId = "22222222-2222-4222-8222-222222222222";
    private const string ShortAnswerId = "55555555-5555-4555-8555-555555555555";

    private sealed class FakeShortAnswerGateway : IShortAnswerGradingGateway
    {
        public Task<ShortAnswerGradingResult> GradeAsync(ShortAnswerGradeRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(ShortAnswerGradingResult.Success(new(
                "correct", 1, request.ReferenceAnswer, "The answer matches the transcript.")));
    }

    private sealed class MutableShortAnswerGateway : IShortAnswerGradingGateway
    {
        public bool Fail { get; set; }

        public Task<ShortAnswerGradingResult> GradeAsync(ShortAnswerGradeRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(Fail
                ? ShortAnswerGradingResult.Failure("providerRateLimited", "The AI provider quota was reached.", true)
                : ShortAnswerGradingResult.Success(new(
                    "correct", 1, request.ReferenceAnswer, "The answer matches the transcript.")));
    }

    private sealed class CountingShortAnswerGateway : IShortAnswerGradingGateway
    {
        public int Calls { get; private set; }
        public Task<ShortAnswerGradingResult> GradeAsync(ShortAnswerGradeRequest request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(ShortAnswerGradingResult.Success(new(
                "correct", 1, request.ReferenceAnswer, "The answer matches the transcript.")));
        }
    }

    private sealed class CoordinatedShortAnswerGateway(int expectedCalls) : IShortAnswerGradingGateway
    {
        private readonly TaskCompletionSource release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int calls;

        public async Task<ShortAnswerGradingResult> GradeAsync(
            ShortAnswerGradeRequest request, CancellationToken cancellationToken)
        {
            if (Interlocked.Increment(ref calls) == expectedCalls) release.TrySetResult();
            await release.Task.WaitAsync(TimeSpan.FromSeconds(5), cancellationToken);
            return ShortAnswerGradingResult.Success(new(
                "correct", 1, request.ReferenceAnswer, "The answer matches the transcript."));
        }
    }
}
