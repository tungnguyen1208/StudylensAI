using StudyLens.Api.BuildingBlocks.Errors;
using StudyLens.Api.Features.SessionQuiz.Application;

namespace StudyLens.Api.Features.SessionQuiz.Api;

internal static class QuizEndpoints
{
    public static async Task<IResult> Generate(GenerateQuizRequest request, QuestionGenerationService service, HttpContext context, CancellationToken cancellationToken)
    {
        var result = await service.GenerateAsync(new(request.SessionId, request.SegmentId, request.YoutubeVideoId, request.QuestionType, request.Difficulty, request.IdempotencyKey), cancellationToken);
        return ToResult(result, context);
    }

    public static async Task<IResult> Get(string quizId, QuestionGenerationService service, HttpContext context, CancellationToken cancellationToken) =>
        await service.GetAsync(quizId, cancellationToken) is { } quiz
            ? Results.Ok(quiz)
            : Results.Json(new ErrorEnvelope("quizNotFound", 404, "Quiz was not found.", context.TraceIdentifier, false), statusCode: 404);

    private static IResult ToResult(QuizGenerationResult result, HttpContext context) => result.Quiz is { } quiz
        ? Results.Ok(quiz)
        : Results.Json(new ErrorEnvelope(result.ErrorCode!, result.StatusCode, result.ErrorMessage!, context.TraceIdentifier, result.StatusCode == 503), statusCode: result.StatusCode);
}

internal sealed record GenerateQuizRequest(string ContractVersion, string SessionId, string SegmentId, string YoutubeVideoId, string QuestionType, string Difficulty, string IdempotencyKey);
