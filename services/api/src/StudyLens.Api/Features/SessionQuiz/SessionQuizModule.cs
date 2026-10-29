namespace StudyLens.Api.Features.SessionQuiz;

using StudyLens.Api.Features.SessionQuiz.Api;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Application.Abstractions;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Features.Accounts;

public static class SessionQuizModule
{
    public static IServiceCollection AddSessionQuizModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddScoped<LearningPackageService>();
        services.AddHostedService<LearningPackageWorker>();
        services.AddScoped<IQuestionAssessmentStore, SqliteQuestionAssessmentStore>();
        services.AddScoped<IQuestionAssessmentReader>(provider => provider.GetRequiredService<IQuestionAssessmentStore>());
        services.AddHttpClient<ITranscriptGenerationGateway, TranscriptGenerationClient>();
        services.AddHttpClient<IFullVideoQuestionGenerationGateway, FullVideoQuestionGenerationClient>();
        return services;
    }

    public static IEndpointRouteBuilder MapSessionQuizEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/sessions", LearningPackageEndpoints.Start).WithName("StartStudySession").WithTags("Session Quiz").RequireAuthorization().RequireRateLimiting(AccountsModule.WritePolicy);
        endpoints.MapPut("/api/sessions/{sessionId}/transcript", LearningPackageEndpoints.SubmitTranscript).WithName("SubmitFullTranscript").WithTags("Session Quiz").RequireAuthorization().RequireRateLimiting(AccountsModule.WritePolicy);
        endpoints.MapGet("/api/sessions/{sessionId}/learning-package", LearningPackageEndpoints.Get).WithName("GetLearningPackage").WithTags("Session Quiz").RequireAuthorization().RequireRateLimiting(AccountsModule.ReadPolicy);
        endpoints.MapPost("/api/sessions/{sessionId}/retry", LearningPackageEndpoints.Retry).WithName("RetryLearningPackageStep").WithTags("Session Quiz").RequireAuthorization().RequireRateLimiting(AccountsModule.WritePolicy);
        endpoints.MapPost("/api/sessions/{sessionId}/complete", LearningPackageEndpoints.Complete).WithName("CompleteStudySession").WithTags("Session Quiz").RequireAuthorization().RequireRateLimiting(AccountsModule.WritePolicy);
        return endpoints;
    }
}
