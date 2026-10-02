using System.Net.Http.Json;
using System.Text.Json;

namespace StudyLens.Api.Features.AssessmentHistory.Application;

public interface IShortAnswerGradingGateway
{
    Task<ShortAnswerGradingResult> GradeAsync(ShortAnswerGradeRequest request, CancellationToken cancellationToken);
}

public sealed class ShortAnswerGradingClient : IShortAnswerGradingGateway
{
    private readonly HttpClient _httpClient;

    public ShortAnswerGradingClient(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _httpClient.BaseAddress = new Uri((configuration["AiService:BaseUrl"] ?? "http://localhost:8000").TrimEnd('/') + "/");
        var timeoutSeconds = configuration.GetValue<double?>("AiService:GradingTimeoutSeconds") ?? 65;
        _httpClient.Timeout = TimeSpan.FromSeconds(timeoutSeconds);
    }

    public async Task<ShortAnswerGradingResult> GradeAsync(ShortAnswerGradeRequest request, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _httpClient.PostAsJsonAsync("api/ai/grading/short-answer", request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var error = await ReadErrorAsync(response, cancellationToken);
                return ShortAnswerGradingResult.Failure(
                    error?.Code ?? "gradingProviderFailed",
                    error?.Message ?? "Short-answer grading is temporarily unavailable.",
                    error?.Retryable ?? (int)response.StatusCode >= 500);
            }

            var grade = await response.Content.ReadFromJsonAsync<ShortAnswerGradeResponse>(cancellationToken: cancellationToken);
            return grade is not null && IsValid(grade)
                ? ShortAnswerGradingResult.Success(grade)
                : ShortAnswerGradingResult.Failure("invalidAiGrade", "The grading provider returned an invalid result.", true);
        }
        catch (HttpRequestException)
        {
            return ShortAnswerGradingResult.Failure("aiUnavailable", "The AI service is unavailable.", true);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return ShortAnswerGradingResult.Failure("providerTimeout", "The grading provider did not answer in time.", true);
        }
        catch (JsonException)
        {
            return ShortAnswerGradingResult.Failure("invalidAiGrade", "The grading provider returned an invalid result.", true);
        }
        catch (NotSupportedException)
        {
            return ShortAnswerGradingResult.Failure("invalidAiGrade", "The grading provider returned an invalid result.", true);
        }
    }

    private static async Task<AiGradingError?> ReadErrorAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            return await response.Content.ReadFromJsonAsync<AiGradingError>(cancellationToken: cancellationToken);
        }
        catch (JsonException) { return null; }
        catch (NotSupportedException) { return null; }
    }

    private static bool IsValid(ShortAnswerGradeResponse response) =>
        (response.Outcome is "correct" or "incorrect" or "partiallyCorrect") &&
        double.IsFinite(response.Score) && response.Score is >= 0 and <= 1 &&
        !string.IsNullOrWhiteSpace(response.ReferenceAnswer) &&
        !string.IsNullOrWhiteSpace(response.Explanation);
}

public sealed record ShortAnswerGradeRequest(string ContractVersion, string QuestionId, string Prompt, string ReferenceAnswer, string AnswerText);
public sealed record ShortAnswerGradeResponse(string Outcome, double Score, string ReferenceAnswer, string Explanation);
public sealed record ShortAnswerGradingResult(ShortAnswerGradeResponse? Grade, string? ErrorCode, string? ErrorMessage, bool Retryable)
{
    public static ShortAnswerGradingResult Success(ShortAnswerGradeResponse grade) => new(grade, null, null, false);
    public static ShortAnswerGradingResult Failure(string code, string message, bool retryable) => new(null, code, message, retryable);
}

internal sealed record AiGradingError(string Code, string Message, bool Retryable);
