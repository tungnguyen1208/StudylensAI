using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using StudyLens.Api.Features.SessionQuiz.Application;
using Xunit;

namespace SessionQuiz.Tests;

public sealed class FullVideoAiClientsTests
{
    [Fact]
    public void QuestionClientTimeout_DefaultsBeyondAiEnvelope()
    {
        var configuration = new ConfigurationBuilder().Build();

        var timeout = FullVideoQuestionGenerationClient.ResolveTimeout(configuration);

        Assert.Equal(TimeSpan.FromSeconds(195), timeout);
    }

    [Theory]
    [InlineData("240", "270", 270)]
    [InlineData("240", "200", 255)]
    [InlineData("invalid", "invalid", 195)]
    public void QuestionClientTimeout_IsConfigurableButAlwaysExceedsEnvelope(
        string envelopeSeconds, string clientSeconds, double expectedSeconds)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AiService:QuestionGenerationEnvelopeSeconds"] = envelopeSeconds,
            ["AiService:QuestionGenerationClientTimeoutSeconds"] = clientSeconds,
        }).Build();

        var timeout = FullVideoQuestionGenerationClient.ResolveTimeout(configuration);

        Assert.Equal(TimeSpan.FromSeconds(expectedSeconds), timeout);
        var parsedEnvelope = double.TryParse(envelopeSeconds, out var value) && value > 0 ? value : 180;
        Assert.True(timeout.TotalSeconds > parsedEnvelope);
    }

    [Theory]
    [InlineData(HttpStatusCode.OK)]
    [InlineData(HttpStatusCode.UnprocessableEntity)]
    public async Task MalformedJson_IsMappedToNonRetryableInvalidAiResponse(HttpStatusCode statusCode)
    {
        using var httpClient = new HttpClient(new StaticResponseHandler(new HttpResponseMessage(statusCode)
        {
            Content = new StringContent("{not-json", Encoding.UTF8, "application/json"),
        }))
        {
            BaseAddress = new Uri("http://localhost/"),
        };

        var result = await TranscriptGenerationClient.SendAsync<object, FullVideoQuestionGenerationResponse>(
            httpClient, "api/ai/question-generation/generate", new { }, CancellationToken.None);

        Assert.Null(result.Value);
        Assert.Equal("invalidAiResponse", result.ErrorCode);
        Assert.False(result.Retryable);
    }

    [Fact]
    public async Task NetworkFailure_IsMappedToRetryableAiUnavailable()
    {
        using var httpClient = new HttpClient(new ThrowingHandler(new HttpRequestException("connection refused")))
        {
            BaseAddress = new Uri("http://localhost/"),
        };

        var result = await TranscriptGenerationClient.SendAsync<object, FullVideoQuestionGenerationResponse>(
            httpClient, "api/ai/question-generation/generate", new { }, CancellationToken.None);

        Assert.Null(result.Value);
        Assert.Equal("aiUnavailable", result.ErrorCode);
        Assert.True(result.Retryable);
    }

    [Fact]
    public async Task CallerCancellation_PropagatesInsteadOfBecomingAiTimeout()
    {
        using var httpClient = new HttpClient(new CancellationHandler())
        {
            BaseAddress = new Uri("http://localhost/"),
        };
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            TranscriptGenerationClient.SendAsync<object, FullVideoQuestionGenerationResponse>(
                httpClient, "api/ai/question-generation/generate", new { }, cancellation.Token));
    }

    [Fact]
    public async Task QuestionClient_CanBeReusedWithoutReconfiguringHttpClient()
    {
        using var httpClient = new HttpClient(new ResponseFactoryHandler(() => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                "{\"contractVersion\":\"0.5.0\",\"promptVersion\":\"0.5.0\",\"questions\":[]}",
                Encoding.UTF8, "application/json"),
        }));
        var client = new FullVideoQuestionGenerationClient(httpClient, new ConfigurationBuilder().Build());
        var request = new FullVideoQuestionGenerationRequest(
            "0.5.0", "0.5.0", Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), "dQw4w9WgXcQ",
            0, 1_000, 3, "multipleChoice", "medium", [new TranscriptCueView(0, 1_000, "Evidence")]);

        var first = await client.GenerateAsync(request, CancellationToken.None);
        var second = await client.GenerateAsync(request, CancellationToken.None);

        Assert.NotNull(first.Value);
        Assert.NotNull(second.Value);
        Assert.Equal(TimeSpan.FromSeconds(195), httpClient.Timeout);
    }

    private sealed class StaticResponseHandler(HttpResponseMessage response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(response);
    }

    private sealed class ResponseFactoryHandler(Func<HttpResponseMessage> responseFactory) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(responseFactory());
    }

    private sealed class ThrowingHandler(Exception exception) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromException<HttpResponseMessage>(exception);
    }

    private sealed class CancellationHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromCanceled<HttpResponseMessage>(cancellationToken);
    }
}
