using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using StudyLens.Api.BuildingBlocks.Http;
using Xunit;

namespace VideoActivation.Tests;

public sealed class AiHealthClientTests
{
    [Fact]
    public async Task CheckHealthAsync_DeserializesSafeProviderDiagnostics()
    {
        using var httpClient = new HttpClient(new StubHandler())
        {
            BaseAddress = new Uri("http://ai.test/")
        };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AiService:BaseUrl"] = "http://ai.test"
        }).Build();

        var result = await new AiHealthClient(httpClient, configuration).CheckHealthAsync();

        Assert.NotNull(result);
        Assert.Equal("ok", result.Status);
        Assert.Equal("gemini", result.ProviderMode);
        Assert.True(result.ProviderConfigured);
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"status\":\"ok\",\"service\":\"studylens-ai\",\"providerMode\":\"gemini\",\"providerConfigured\":true}",
                    Encoding.UTF8,
                    "application/json")
            });
    }
}
