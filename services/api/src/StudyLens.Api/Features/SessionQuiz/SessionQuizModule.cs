namespace StudyLens.Api.Features.SessionQuiz;

public static class SessionQuizModule
{
    public static IServiceCollection AddSessionQuizModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Dev 2 will register Session, Segment, and Quiz generation services here.
        return services;
    }

    public static IEndpointRouteBuilder MapSessionQuizEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        // Dev 2 will map endpoints for sessions, segmenting, and quiz fetching here.
        return endpoints;
    }
}
