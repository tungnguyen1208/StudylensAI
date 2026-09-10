namespace StudyLens.Api.Features.SessionQuiz;

using StudyLens.Api.Features.SessionQuiz.Api;
using StudyLens.Api.Features.SessionQuiz.Application;

public static class SessionQuizModule
{
    public static IServiceCollection AddSessionQuizModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddSingleton<StudySessionService>();
        return services;
    }

    public static IEndpointRouteBuilder MapSessionQuizEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/sessions", StudySessionEndpoints.Start).WithName("StartStudySession").WithTags("Session Quiz");
        endpoints.MapPost("/api/sessions/{sessionId}/complete", StudySessionEndpoints.Complete).WithName("CompleteStudySession").WithTags("Session Quiz");
        return endpoints;
    }
}
