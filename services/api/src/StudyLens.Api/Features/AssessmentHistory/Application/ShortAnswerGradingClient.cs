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
            return response.IsSuccessStatusCode ? await response.Content.ReadFromJsonAsync<ShortAnswerGradeResponse>(cancellationToken: cancellationToken) : null;
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) { return null; }
        catch (JsonException) { return null; }
        catch (NotSupportedException) { return null; }
    }
}

public sealed record ShortAnswerGradeRequest(string QuestionId, string Prompt, string ReferenceAnswer, string AnswerText);
public sealed record ShortAnswerGradeResponse(string Outcome, double Score, string ReferenceAnswer, string Explanation);
