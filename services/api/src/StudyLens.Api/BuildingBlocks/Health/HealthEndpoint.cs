using Microsoft.EntityFrameworkCore;
using StudyLens.Api.BuildingBlocks.Http;
using StudyLens.Api.Infrastructure.Persistence;

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

        endpoints.MapGet("/api/health/live", () => Results.Ok(new
        {
            status = "ok",
            service = "studylens-api"
        }))
        .WithName("GetLiveness");

        endpoints.MapGet("/api/health/ready", async (
            StudyLensDbContext db,
            AiHealthClient aiHealthClient,
            CancellationToken ct) =>
        {
            var databaseReady = false;
            try
            {
                databaseReady = await db.Database.CanConnectAsync(ct);
            }
            catch
            {
                // Readiness responses deliberately omit connection/provider details.
            }

            var aiHealth = await aiHealthClient.CheckHealthAsync(ct);
            var aiReady = string.Equals(aiHealth?.Status, "ok", StringComparison.OrdinalIgnoreCase);
            var ready = databaseReady && aiReady;
            return Results.Json(new
            {
                status = ready ? "ready" : "notReady",
                service = "studylens-api",
                database = databaseReady ? "ready" : "unavailable",
                aiService = aiReady ? "ready" : "unavailable"
            }, statusCode: ready ? StatusCodes.Status200OK : StatusCodes.Status503ServiceUnavailable);
        })
        .WithName("GetReadiness");

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
