using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.AssessmentHistory.Application;
using StudyLens.Api.Features.AssessmentHistory.Infrastructure;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;
using Xunit;

namespace AssessmentHistory.Tests;

public sealed class AccountIsolationTests
{
    [Fact]
    public async Task ForeignAccount_CannotReadHistoryOrSubmitToAnotherAccountsQuiz()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        SeedOwnedQuizAndAttempt(db);
        await db.SaveChangesAsync();
        var service = new AssessmentHistoryService(new AssessmentHistoryDbContext(db),
            new SqliteQuestionAssessmentStore(db), new NoopGradingGateway(), db);

        var ownerHistory = await service.ReadHistoryAsync("user-a", null, CancellationToken.None);
        var foreignHistory = await service.ReadHistoryAsync("user-b", null, CancellationToken.None);
        var foreignSubmit = await service.SubmitAttemptAsync("user-b", new SubmitQuizAttemptCommand("0.7.0",
            Guid.NewGuid().ToString(), "quiz-a", [new SubmitAttemptAnswer("question-a", "option-a", null)]), CancellationToken.None);

        Assert.Single(ownerHistory);
        Assert.Empty(foreignHistory);
        Assert.Equal(404, foreignSubmit.StatusCode);
        Assert.Equal("quizNotFound", foreignSubmit.ErrorCode);
    }

    private static void SeedOwnedQuizAndAttempt(StudyLensDbContext db)
    {
        db.Add(new StudyVideoEntity { YoutubeVideoId = "dQw4w9WgXcQ", Title = "Owner lesson", CreatedAtUtc = DateTimeOffset.UtcNow, LastSeenAtUtc = DateTimeOffset.UtcNow });
        db.Add(new StudySessionEntity
        {
            UserId = "user-a", SessionId = "session-a", ActivationId = "activation-a", StartIdempotencyKey = "session-owner-a",
            YoutubeVideoId = "dQw4w9WgXcQ", VideoTitle = "Owner lesson", Status = "completed", TranscriptStatus = "ready",
            QuizStatus = "ready", QuizId = "quiz-a", StartedAtUtc = DateTimeOffset.UtcNow,
        });
        db.Add(new QuizAssessmentEntity
        {
            UserId = "user-a", QuizId = "quiz-a", IdempotencyKey = "quiz-owner-a", SessionId = "session-a", SegmentId = string.Empty,
            YoutubeVideoId = "dQw4w9WgXcQ", Status = "ready", CreatedAtUtc = DateTimeOffset.UtcNow,
            Questions =
            [
                new QuestionAssessmentEntity
                {
                    QuestionId = "question-a", QuizId = "quiz-a", Type = "multipleChoice", Prompt = "Owner question",
                    CorrectOptionId = "option-a", Explanation = "Owner evidence", YoutubeVideoId = "dQw4w9WgXcQ",
                    SourceStartMs = 0, SourceEndMs = 1000,
                    Options = [new QuestionOptionEntity { QuestionOptionId = "row-option-a", QuestionId = "question-a", OptionId = "option-a", Text = "Correct", Position = 0 }],
                },
            ],
        });
        db.Add(new AnswerAttemptEntity
        {
            UserId = "user-a", AnswerAttemptId = "answer-a", ClientAttemptId = "client-a", QuizId = "quiz-a", SessionId = "session-a",
            QuestionId = "question-a", YoutubeVideoId = "dQw4w9WgXcQ", QuestionPrompt = "Owner question", QuestionType = "multipleChoice",
            SubmittedAnswer = "option-a", Outcome = "correct", Score = 1, ReferenceAnswer = "Correct", Explanation = "Owner evidence",
            SourceStartMs = 0, SourceEndMs = 1000, GradedAtUtc = DateTimeOffset.UtcNow,
        });
    }

    private sealed class NoopGradingGateway : IShortAnswerGradingGateway
    {
        public Task<ShortAnswerGradingResult> GradeAsync(ShortAnswerGradeRequest request, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("No short-answer grading is expected in this test.");
    }
}
