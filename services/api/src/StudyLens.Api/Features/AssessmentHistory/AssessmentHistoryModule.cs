using StudyLens.Api.Features.AssessmentHistory.Api;
using StudyLens.Api.Features.AssessmentHistory.Application;
using StudyLens.Api.Features.AssessmentHistory.Infrastructure;

namespace StudyLens.Api.Features.AssessmentHistory;

public static class AssessmentHistoryModule
{
    public static IServiceCollection AddAssessmentHistoryModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddScoped<AssessmentHistoryDbContext>();
        services.AddScoped<AssessmentHistoryService>();
        services.AddHttpClient<IShortAnswerGradingGateway, ShortAnswerGradingClient>();
        return services;
    }

    public static IEndpointRouteBuilder MapAssessmentHistoryEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/quizzes/{quizId}/answer", AssessmentHistoryEndpoints.Submit).WithName("SubmitQuizAnswer").WithTags("Assessment History");
        endpoints.MapGet("/api/history", AssessmentHistoryEndpoints.History).WithName("GetLearningHistory").WithTags("Assessment History");
        endpoints.MapGet("/api/history/videos/{videoId}", (string videoId, AssessmentHistoryService service, CancellationToken cancellationToken) =>
            AssessmentHistoryEndpoints.History(videoId, service, cancellationToken)).WithName("GetVideoLearningHistory").WithTags("Assessment History");
        return endpoints;
    }
}
