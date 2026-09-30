using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StudyLens.Api.Features.SessionQuiz;
using StudyLens.Api.Features.SessionQuiz.Application;
using Xunit;

namespace SessionQuiz.Tests;

public sealed class SessionQuizModuleTests
{
    [Fact]
    public void AddSessionQuizModule_RegistersFullVideoOrchestration()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSessionQuizModule(new ConfigurationBuilder().Build());
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(LearningPackageService));
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(ITranscriptGenerationGateway));
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IFullVideoQuestionGenerationGateway));
        Assert.Contains(services, descriptor => descriptor.ImplementationType == typeof(LearningPackageWorker));
    }
}
