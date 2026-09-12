using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StudyLens.Api.Features.SessionQuiz;
using StudyLens.Api.Features.SessionQuiz.Application;
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
}
