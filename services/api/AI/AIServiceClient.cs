using System.Net.Http.Json;
using StudyLens.Api.Common.Responses;

namespace StudyLens.Api.AI;

public sealed class AIServiceClient
{
    private readonly HttpClient _httpClient;

    public AIServiceClient(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<AIHealthResponse> GetHealthAsync(CancellationToken cancellationToken)
    {
        var response = await _httpClient.GetFromJsonAsync<AIHealthResponse>("/health", cancellationToken);

        return response ?? new AIHealthResponse("unknown", "studylens-ai-service");
    }
}

