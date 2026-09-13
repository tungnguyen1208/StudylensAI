using System.Net.Http.Json;

namespace StudyLens.Api.Features.SessionQuiz.Application;

public interface IQuestionGenerationGateway
{
    Task<QuestionGenerationResponse?> GenerateAsync(QuestionGenerationRequest request, CancellationToken cancellationToken);
}

public sealed class QuestionGenerationClient : IQuestionGenerationGateway
{
    private readonly HttpClient _httpClient;

    public QuestionGenerationClient(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        var baseUrl = configuration["AiService:BaseUrl"] ?? "http://localhost:8000";
        _httpClient.BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/");
        _httpClient.Timeout = TimeSpan.FromSeconds(5);
    }

    public async Task<QuestionGenerationResponse?> GenerateAsync(QuestionGenerationRequest request, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _httpClient.PostAsJsonAsync("api/ai/question-generation/generate", request, cancellationToken);
            return response.IsSuccessStatusCode
                ? await response.Content.ReadFromJsonAsync<QuestionGenerationResponse>(cancellationToken: cancellationToken)
                : null;
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) { return null; }
    }
}

public sealed record QuestionGenerationRequest(
    string ContractVersion, string PromptVersion, string SegmentId, string YoutubeVideoId,
    long StartMs, long EndMs, string QuestionType, string Difficulty, IReadOnlyList<TranscriptCue> Cues);

public sealed record QuestionGenerationResponse(string ContractVersion, string PromptVersion, IReadOnlyList<GeneratedQuestion> Questions);
public sealed record GeneratedQuestion(string Type, string Prompt, IReadOnlyList<GeneratedOption>? Options, string? CorrectOptionId, string? ReferenceAnswer, long SourceStartMs, long SourceEndMs);
public sealed record GeneratedOption(string OptionId, string Text);
