using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StudyLens.Api.Features.VideoActivation;
using Xunit;

namespace VideoActivation.Tests;

public class VideoActivationModuleTests
{
    [Fact]
    public void AddVideoActivationModule_ShouldRegisterSuccessfully()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();

        // Act
        services.AddVideoActivationModule(configuration);
        var provider = services.BuildServiceProvider();

        // Assert
        Assert.NotNull(provider);
    }
}
