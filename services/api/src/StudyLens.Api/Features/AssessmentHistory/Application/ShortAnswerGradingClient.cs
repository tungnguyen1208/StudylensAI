using System.Net.Http.Json;
using System.Text.Json;

namespace StudyLens.Api.Features.AssessmentHistory.Application;

public interface IShortAnswerGradingGateway
{
    Task<ShortAnswerGradeResponse?> GradeAsync(ShortAnswerGradeRequest request, CancellationToken cancellationToken);
}

public sealed class ShortAnswerGradingClient : IShortAnswerGradingGateway
{
    private readonly HttpClient _httpClient;

    public ShortAnswerGradingClient(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _httpClient.BaseAddress = new Uri((configuration["AiService:BaseUrl"] ?? "http://localhost:8000").TrimEnd('/') + "/");
        _httpClient.Timeout = TimeSpan.FromSeconds(5);
    }

    public async Task<ShortAnswerGradeResponse?> GradeAsync(ShortAnswerGradeRequest request, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _httpClient.PostAsJsonAsync("api/ai/grading/short-answer", request, cancellationToken);
            if (!response.IsSuccessStatusCode) return null;
            var grade = await response.Content.ReadFromJsonAsync<ShortAnswerGradeResponse>(cancellationToken: cancellationToken);
            return grade is not null && IsValid(grade) ? grade : null;
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) { return null; }
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
