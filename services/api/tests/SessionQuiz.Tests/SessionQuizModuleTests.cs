using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StudyLens.Api.Features.SessionQuiz;
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
}
