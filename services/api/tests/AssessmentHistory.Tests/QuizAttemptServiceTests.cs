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
        var command = new SubmitQuizAttemptCommand("0.5.0", "77777777-7777-4777-8777-777777777777", QuizId,
        [
            new SubmitAttemptAnswer(MultipleChoiceId, "option-a", null),
            new SubmitAttemptAnswer(ShortAnswerId, null, "IP routes packets."),
        ]);

        var first = await service.SubmitAttemptAsync(command, CancellationToken.None);
        var replay = await service.SubmitAttemptAsync(command, CancellationToken.None);
        var history = await service.ReadHistoryAsync("dQw4w9WgXcQ", CancellationToken.None);

        Assert.NotNull(first.Attempt);
        Assert.Equal(first.Attempt!.QuizAttemptId, replay.Attempt!.QuizAttemptId);
        Assert.Equal(1, first.Attempt.Score);
        Assert.Equal(2, first.Attempt.Results.Count);
        Assert.Equal(2, history.Count);
        Assert.Equal(2, await db.Set<AttemptAnswerEntity>().CountAsync());
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
            "0.5.0", "88888888-8888-4888-8888-888888888888", QuizId,
            [new SubmitAttemptAnswer(MultipleChoiceId, "option-a", null)]), CancellationToken.None);

        Assert.Equal(StatusCodes.Status400BadRequest, result.StatusCode);
        Assert.Equal("incompleteAttempt", result.ErrorCode);
        Assert.Empty(await db.Set<QuizAttemptEntity>().ToArrayAsync());
    }

    private static void SeedQuiz(StudyLensDbContext db) => db.Add(new QuizAssessmentEntity
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

    private const string QuizId = "11111111-1111-4111-8111-111111111111";
    private const string MultipleChoiceId = "22222222-2222-4222-8222-222222222222";
    private const string ShortAnswerId = "55555555-5555-4555-8555-555555555555";

    private sealed class FakeShortAnswerGateway : IShortAnswerGradingGateway
    {
        public Task<ShortAnswerGradeResponse?> GradeAsync(ShortAnswerGradeRequest request, CancellationToken cancellationToken) =>
            Task.FromResult<ShortAnswerGradeResponse?>(new("correct", 1, request.ReferenceAnswer, "The answer matches the transcript."));
    }
}
