namespace StudyLens.Api.Features.SessionQuiz;

using StudyLens.Api.Features.SessionQuiz.Api;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Application.Abstractions;
using StudyLens.Api.Features.SessionQuiz.Application.CreateSegment;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;

public static class SessionQuizModule
{
    public static IServiceCollection AddSessionQuizModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddSingleton<StudySessionService>();
        services.AddScoped<IQuestionAssessmentStore, SqliteQuestionAssessmentStore>();
        services.AddScoped<IQuestionAssessmentReader>(provider => provider.GetRequiredService<IQuestionAssessmentStore>());
        services.AddScoped<QuestionGenerationService>();
        services.AddSingleton<ISegmentRepository, InMemorySegmentStore>();
        services.AddScoped<CreateSegmentHandler>();
        services.AddHttpClient<IQuestionGenerationGateway, QuestionGenerationClient>();
        return services;
    }

    public static IEndpointRouteBuilder MapSessionQuizEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/sessions", StudySessionEndpoints.Start).WithName("StartStudySession").WithTags("Session Quiz");
        endpoints.MapPost("/api/sessions/{sessionId}/complete", StudySessionEndpoints.Complete).WithName("CompleteStudySession").WithTags("Session Quiz");
        endpoints.MapPost("/api/sessions/{sessionId}/segments", CreateSegmentEndpoint.HandleAsync).WithName("CreateStudySegment").WithTags("Session Quiz");
        endpoints.MapPost("/api/quizzes/generate", QuizEndpoints.Generate).WithName("GenerateQuiz").WithTags("Session Quiz");
        endpoints.MapGet("/api/quizzes/{quizId}", QuizEndpoints.Get).WithName("GetQuiz").WithTags("Session Quiz");
        return endpoints;
    }
}
