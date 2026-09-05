using StudyLens.Api.BuildingBlocks.Http;

namespace StudyLens.Api.BuildingBlocks.Health;

public static class HealthEndpoint
{
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/health", () => Results.Ok(new
        {
            status = "ok",
            service = "studylens-api"
        }))
        .WithName("GetHealth");

        endpoints.MapGet("/api/health/ai", async (AiHealthClient aiHealthClient, CancellationToken ct) =>
        {
            var aiHealth = await aiHealthClient.CheckHealthAsync(ct);
            return Results.Ok(new
            {
                status = "ok",
                service = "studylens-api",
                aiService = aiHealth is not null ? (object)aiHealth : new { status = "unavailable", service = "studylens-ai" }
            });
        })
        .WithName("GetAiHealth");

        return endpoints;
    }
}
