using StudyLens.Api.BuildingBlocks.Errors;
using StudyLens.Api.Features.AssessmentHistory.Application;

namespace StudyLens.Api.Features.AssessmentHistory.Api;

internal static class AssessmentHistoryEndpoints
{
    public static async Task<IResult> Submit(string quizId, SubmitAnswerRequest request, AssessmentHistoryService service, HttpContext context, CancellationToken cancellationToken)
    {
        var result = await service.SubmitAsync(new(request.ContractVersion, request.ClientAttemptId, quizId, request.QuestionId, request.SelectedOptionId, request.AnswerText), cancellationToken);
        return result.Grade is { } grade
            ? Results.Ok(grade)
            : Results.Json(new ErrorEnvelope(result.ErrorCode!, result.StatusCode, result.ErrorMessage!, context.TraceIdentifier, result.StatusCode == StatusCodes.Status503ServiceUnavailable), statusCode: result.StatusCode);
    }

    public static async Task<IResult> History(string? videoId, AssessmentHistoryService service, CancellationToken cancellationToken) =>
        Results.Ok(new { items = await service.ReadHistoryAsync(videoId, cancellationToken) });
}

internal sealed record SubmitAnswerRequest(string ContractVersion, string ClientAttemptId, string QuestionId, string? SelectedOptionId, string? AnswerText);
