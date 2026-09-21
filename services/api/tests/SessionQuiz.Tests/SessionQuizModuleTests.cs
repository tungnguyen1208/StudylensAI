using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.SessionQuiz;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Domain;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;
using System.Text.Json;
using Xunit;

namespace SessionQuiz.Tests;

public class SessionQuizModuleTests
{
    [Fact]
    public void AddSessionQuizModule_ShouldRegisterSuccessfully()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();

        // Act
        services.AddSessionQuizModule(configuration);
        var provider = services.BuildServiceProvider();

        // Assert
        Assert.NotNull(provider);
    }

    [Fact]
    public void StudySessionService_ReplaysStartAndCompletesOnlyOnce()
    {
        var service = new StudySessionService();
        var start = new StartStudySessionCommand(
            "11111111-1111-4111-8111-111111111111", "active", "dQw4w9WgXcQ", null, 10, "multipleChoice", "medium");

        var first = service.Start(start);
        var replay = service.Start(start);
        var completed = service.Complete(new CompleteStudySessionCommand(
            first.Session!.SessionId, "22222222-2222-4222-8222-222222222222", "videoEnded", 60000));
        var completionReplay = service.Complete(new CompleteStudySessionCommand(
            first.Session.SessionId, "22222222-2222-4222-8222-222222222222", "videoEnded", 60000));

        Assert.Equal(first.Session.SessionId, replay.Session!.SessionId);
        Assert.Equal("completed", completed.Session!.Status);
        Assert.Equal(completed.Session.SessionId, completionReplay.Session!.SessionId);
    }

    [Fact]
    public void StudySessionService_RejectsInactiveActivation()
    {
        var result = new StudySessionService().Start(new StartStudySessionCommand(
            "11111111-1111-4111-8111-111111111111", "inactive", "dQw4w9WgXcQ", null, 10, "multipleChoice", "medium"));

        Assert.Equal("activationInactive", result.ErrorCode);
    }

    [Fact]
    public async Task QuestionGenerationService_MapsFakeAiOutputToPublicQuizAndReplaysIdempotently()
    {
        var segments = new InMemorySegmentStore();
        const string sessionId = "11111111-1111-4111-8111-111111111111";
        const string segmentId = "22222222-2222-4222-8222-222222222222";
        segments.GetOrAdd(sessionId, "client-segment-1", _ => new StudySegment(
            segmentId, sessionId, "client-segment-1", "dQw4w9WgXcQ", 1, 0, 30_000, 30_000,
            [new PlaybackSpan(0, 30_000)],
            [new StudySegmentCue("cue-1", 0, 30_000, "TCP/IP routes network data.")],
            "fingerprint", DateTimeOffset.UtcNow));
        var service = new QuestionGenerationService(new FakeQuestionGenerationGateway(), segments);
        var command = new GenerateQuizCommand(
            sessionId, segmentId, "dQw4w9WgXcQ", "multipleChoice", "easy", "week-one-demo-key");

        var first = await service.GenerateAsync(command, CancellationToken.None);
        var replay = await service.GenerateAsync(command, CancellationToken.None);
        var publicJson = JsonSerializer.Serialize(first.Quiz);

        Assert.NotNull(first.Quiz);
        Assert.Equal(first.Quiz!.QuizId, replay.Quiz!.QuizId);
        Assert.DoesNotContain("correctOptionId", publicJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("referenceAnswer", publicJson, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SqliteQuestionAssessmentStore_RestoresPublicQuizAndPrivateGradingMaterialAfterRestart()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"studylens-quiz-{Guid.NewGuid()}.db");
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite($"Data Source={databasePath}").Options;
        const string sessionId = "11111111-1111-4111-8111-111111111111";
        const string segmentId = "22222222-2222-4222-8222-222222222222";
        const string quizKey = "persisted-quiz-key";

        await using (var db = new StudyLensDbContext(options))
        {
            await db.Database.MigrateAsync();
            var segments = new InMemorySegmentStore();
            segments.GetOrAdd(sessionId, "persisted-segment", _ => new StudySegment(
                segmentId, sessionId, "persisted-segment", "dQw4w9WgXcQ", 1, 0, 30_000, 30_000,
                [new PlaybackSpan(0, 30_000)], [new StudySegmentCue("cue", 0, 30_000, "Network routing.")], "hash", DateTimeOffset.UtcNow));
            var service = new QuestionGenerationService(new FakeQuestionGenerationGateway(), segments, new SqliteQuestionAssessmentStore(db));
            var generated = await service.GenerateAsync(new GenerateQuizCommand(
                sessionId, segmentId, "dQw4w9WgXcQ", "multipleChoice", "easy", quizKey), CancellationToken.None);

            Assert.NotNull(generated.Quiz);
        }

        await using (var restartedDb = new StudyLensDbContext(options))
        {
            var store = new SqliteQuestionAssessmentStore(restartedDb);
            var replay = await store.FindByIdempotencyKeyAsync(quizKey, CancellationToken.None);
            var publicQuiz = await store.FindQuizAsync(replay!.Quiz.QuizId, CancellationToken.None);
            var privateQuestion = await store.FindAsync(replay.Quiz.QuizId, replay.Questions[0].QuestionId, CancellationToken.None);

            Assert.NotNull(publicQuiz);
            Assert.Equal(
                replay.Quiz.Questions[0].Options!.Select(option => option.OptionId),
                publicQuiz!.Questions[0].Options!.Select(option => option.OptionId));
            Assert.Equal("option-a", privateQuestion!.CorrectOptionId);
        }
    }

    private sealed class FakeQuestionGenerationGateway : IQuestionGenerationGateway
    {
        public Task<QuestionGenerationResponse?> GenerateAsync(QuestionGenerationRequest request, CancellationToken cancellationToken) =>
            Task.FromResult<QuestionGenerationResponse?>(new(
                "0.2.0", "0.2.0",
                [new GeneratedQuestion(
                    "multipleChoice", "What does the transcript describe?",
                    [new GeneratedOption("option-a", "Network routing"), new GeneratedOption("option-b", "A database table")],
                    "option-a", null, 0, 30_000)]));
    }
}
