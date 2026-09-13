using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StudyLens.Api.Features.SessionQuiz;
using StudyLens.Api.Features.SessionQuiz.Application;
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
        var service = new QuestionGenerationService(new FakeQuestionGenerationGateway());
        var command = new GenerateQuizCommand(
            "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "dQw4w9WgXcQ",
            "multipleChoice", "easy", [new TranscriptCue(0, 30_000, "TCP/IP routes network data.")], "week-one-demo-key");

        var first = await service.GenerateAsync(command, CancellationToken.None);
        var replay = await service.GenerateAsync(command, CancellationToken.None);
        var publicJson = JsonSerializer.Serialize(first.Quiz);

        Assert.NotNull(first.Quiz);
        Assert.Equal(first.Quiz!.QuizId, replay.Quiz!.QuizId);
        Assert.DoesNotContain("correctOptionId", publicJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("referenceAnswer", publicJson, StringComparison.OrdinalIgnoreCase);
    }

    private sealed class FakeQuestionGenerationGateway : IQuestionGenerationGateway
    {
        public Task<QuestionGenerationResponse?> GenerateAsync(QuestionGenerationRequest request, CancellationToken cancellationToken) =>
            Task.FromResult<QuestionGenerationResponse?>(new(
                "0.1.0", "0.1.0",
                [new GeneratedQuestion(
                    "multipleChoice", "What does the transcript describe?",
                    [new GeneratedOption("option-a", "Network routing"), new GeneratedOption("option-b", "A database table")],
                    "option-a", null, 0, 30_000)]));
    }
}
