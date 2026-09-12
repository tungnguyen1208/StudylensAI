using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace StudyLens.Api.BuildingBlocks.Http;

public record AiHealthResponse(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("service")] string Service);

public class AiHealthClient
{
    private readonly HttpClient _httpClient;

    public AiHealthClient(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        var baseUrl = configuration["AiService:BaseUrl"] ?? "http://localhost:8000";
        _httpClient.BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/");
        _httpClient.Timeout = TimeSpan.FromSeconds(5);
    }

    public async Task<AiHealthResponse?> CheckHealthAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            return await _httpClient.GetFromJsonAsync<AiHealthResponse>("health", cancellationToken);
        }
        catch
        {
            return null;
        }
    }
}
