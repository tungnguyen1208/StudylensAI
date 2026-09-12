using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StudyLens.Api.Features.AssessmentHistory;
using Xunit;

namespace AssessmentHistory.Tests;

public class AssessmentHistoryModuleTests
{
    [Fact]
    public void AddAssessmentHistoryModule_ShouldRegisterSuccessfully()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();

        // Act
        services.AddAssessmentHistoryModule(configuration);
        var provider = services.BuildServiceProvider();

        // Assert
        Assert.NotNull(provider);
    }
}
