using StudyLens.Api.Features.AssessmentHistory.Api;
using StudyLens.Api.Features.AssessmentHistory.Application;
using StudyLens.Api.Features.AssessmentHistory.Infrastructure;
using StudyLens.Api.Features.Accounts;

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
        endpoints.MapPost("/api/quizzes/{quizId}/attempts", AssessmentHistoryEndpoints.SubmitAttempt).WithName("SubmitQuizAttempt").WithTags("Assessment History").RequireAuthorization().RequireRateLimiting(AccountsModule.WritePolicy);
        endpoints.MapGet("/api/history", AssessmentHistoryEndpoints.History).WithName("GetLearningHistory").WithTags("Assessment History").RequireAuthorization().RequireRateLimiting(AccountsModule.ReadPolicy);
        endpoints.MapGet("/api/history/videos/{videoId}", (string videoId, AssessmentHistoryService service, HttpContext context, CancellationToken cancellationToken) =>
            AssessmentHistoryEndpoints.History(videoId, service, context, cancellationToken)).WithName("GetVideoLearningHistory").WithTags("Assessment History").RequireAuthorization().RequireRateLimiting(AccountsModule.ReadPolicy);
        return endpoints;
    }
}
