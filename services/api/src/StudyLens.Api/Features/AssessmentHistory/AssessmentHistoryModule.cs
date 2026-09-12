namespace StudyLens.Api.Features.AssessmentHistory;

public static class AssessmentHistoryModule
{
    public static IServiceCollection AddAssessmentHistoryModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Dev 3 will register Assessment, Grading orchestration, and History services here.
        return services;
    }

    public static IEndpointRouteBuilder MapAssessmentHistoryEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        // Dev 3 will map endpoints for answer submissions, grading results, and history queries here.
        return endpoints;
    }
}
