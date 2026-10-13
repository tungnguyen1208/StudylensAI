using System.Net.Http.Json;
using System.Globalization;
using System.Text.Json;

namespace StudyLens.Api.Features.SessionQuiz.Application;

public interface ITranscriptGenerationGateway
{
    Task<AiGatewayResult<TranscriptGenerationResponse>> GenerateAsync(TranscriptGenerationRequest request, CancellationToken cancellationToken);
}

public interface IFullVideoQuestionGenerationGateway
{
    Task<AiGatewayResult<FullVideoQuestionGenerationResponse>> GenerateAsync(FullVideoQuestionGenerationRequest request, CancellationToken cancellationToken);
}

public sealed class TranscriptGenerationClient : ITranscriptGenerationGateway
{
    private readonly HttpClient httpClient;

    public TranscriptGenerationClient(HttpClient httpClient, IConfiguration configuration)
    {
        this.httpClient = httpClient;
        Configure(httpClient, configuration, TimeSpan.FromSeconds(300));
    }

    public async Task<AiGatewayResult<TranscriptGenerationResponse>> GenerateAsync(TranscriptGenerationRequest request, CancellationToken cancellationToken)
    {
        return await SendAsync<TranscriptGenerationRequest, TranscriptGenerationResponse>(httpClient, "api/ai/transcripts/generate", request, cancellationToken);
    }

    internal static void Configure(HttpClient client, IConfiguration configuration, TimeSpan timeout)
    {
        client.BaseAddress ??= new Uri((configuration["AiService:BaseUrl"] ?? "http://localhost:8000").TrimEnd('/') + "/");
        client.Timeout = timeout;
    }

    internal static async Task<AiGatewayResult<TResponse>> SendAsync<TRequest, TResponse>(HttpClient client, string path, TRequest request, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await client.PostAsJsonAsync(path, request, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                var value = await response.Content.ReadFromJsonAsync<TResponse>(cancellationToken: cancellationToken);
                return value is null
                    ? AiGatewayResult<TResponse>.Failure("invalidAiResponse", "The AI Service returned an empty response.", false)
                    : AiGatewayResult<TResponse>.Success(value);
            }
            var error = await response.Content.ReadFromJsonAsync<AiErrorResponse>(cancellationToken: cancellationToken);
            return AiGatewayResult<TResponse>.Failure(error?.Code ?? "aiServiceRejected", error?.Message ?? "The AI Service rejected the request.", error?.Retryable ?? response.StatusCode >= System.Net.HttpStatusCode.InternalServerError);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return AiGatewayResult<TResponse>.Failure("aiTimeout", "The AI Service request timed out.", true);
        }
        catch (HttpRequestException)
        {
            return AiGatewayResult<TResponse>.Failure("aiUnavailable", "The AI Service is unavailable.", true);
        }
        catch (Exception exception) when (exception is JsonException or NotSupportedException)
        {
            return AiGatewayResult<TResponse>.Failure(
                "invalidAiResponse", "The AI Service returned malformed JSON.", false);
        }
    }
}

public sealed class FullVideoQuestionGenerationClient : IFullVideoQuestionGenerationGateway
{
    private readonly HttpClient httpClient;

    public FullVideoQuestionGenerationClient(HttpClient httpClient, IConfiguration configuration)
    {
        this.httpClient = httpClient;
        TranscriptGenerationClient.Configure(httpClient, configuration, ResolveTimeout(configuration));
    }

    public async Task<AiGatewayResult<FullVideoQuestionGenerationResponse>> GenerateAsync(FullVideoQuestionGenerationRequest request, CancellationToken cancellationToken)
    {
        return await TranscriptGenerationClient.SendAsync<FullVideoQuestionGenerationRequest, FullVideoQuestionGenerationResponse>(
            httpClient, "api/ai/question-generation/generate", request, cancellationToken);
    }

    internal static TimeSpan ResolveTimeout(IConfiguration configuration)
    {
        const double defaultEnvelopeSeconds = 180;
        const double defaultGraceSeconds = 15;
        var envelopeSeconds = ReadPositiveSeconds(configuration["AiService:QuestionGenerationEnvelopeSeconds"])
            ?? defaultEnvelopeSeconds;
        var configuredClientSeconds = ReadPositiveSeconds(configuration["AiService:QuestionGenerationClientTimeoutSeconds"]);
        var clientSeconds = configuredClientSeconds is > 0 && configuredClientSeconds > envelopeSeconds
            ? configuredClientSeconds.Value
            : envelopeSeconds + defaultGraceSeconds;
        return TimeSpan.FromSeconds(clientSeconds);
    }

    private static double? ReadPositiveSeconds(string? value) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds) && seconds > 0
            ? seconds
            : null;
}

public sealed record AiGatewayResult<T>(T? Value, string? ErrorCode, string? ErrorMessage, bool Retryable)
{
    public static AiGatewayResult<T> Success(T value) => new(value, null, null, false);
    public static AiGatewayResult<T> Failure(string code, string message, bool retryable) => new(default, code, message, retryable);
}

public sealed record AiErrorResponse(string Code, string Message, bool Retryable);
public sealed record TranscriptGenerationRequest(string ContractVersion, string YoutubeVideoId);
public sealed record TranscriptGenerationResponse(string ContractVersion, string YoutubeVideoId, string Source, string Language, long? DurationMs, IReadOnlyList<TranscriptCueView> Cues);
public sealed record FullVideoQuestionGenerationRequest(string ContractVersion, string PromptVersion, string SessionId,
    string TranscriptCaptureId, string YoutubeVideoId, string VideoTitle, long StartMs, long EndMs, int QuestionCount,
    string QuestionType, string Difficulty, IReadOnlyList<TranscriptCueView> Cues);
public sealed record FullVideoQuestionGenerationResponse(string ContractVersion, string PromptVersion, IReadOnlyList<FullVideoGeneratedQuestion> Questions);
public sealed record FullVideoGeneratedQuestion(string Type, string Prompt, IReadOnlyList<FullVideoGeneratedOption>? Options,
    string? CorrectOptionId, string? ReferenceAnswer, string Explanation, long SourceStartMs, long SourceEndMs);
public sealed record FullVideoGeneratedOption(string OptionId, string Text);
