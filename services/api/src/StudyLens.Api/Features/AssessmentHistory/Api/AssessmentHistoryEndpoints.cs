using StudyLens.Api.BuildingBlocks.Errors;
using StudyLens.Api.Features.AssessmentHistory.Application;
using StudyLens.Api.Features.Accounts.Application;

namespace StudyLens.Api.Features.AssessmentHistory.Api;

internal static class AssessmentHistoryEndpoints
{
    public static async Task<IResult> SubmitAttempt(string quizId, SubmitQuizAttemptRequest request, AssessmentHistoryService service, HttpContext context, CancellationToken cancellationToken)
    {
        var result = await service.SubmitAttemptAsync(context.User.UserId(), new(request.ContractVersion, request.ClientAttemptId, quizId,
            request.Answers.Select(item => new SubmitAttemptAnswer(item.QuestionId, item.SelectedOptionId, item.AnswerText)).ToArray()), cancellationToken);
        return result.Attempt is { } attempt
            ? Results.Ok(attempt)
            : Error(result.ErrorCode!, result.StatusCode, result.ErrorMessage!, result.Retryable, result.ResetAtUtc, context);
    }

    public static async Task<IResult> Submit(string quizId, SubmitAnswerRequest request, AssessmentHistoryService service, HttpContext context, CancellationToken cancellationToken)
    {
        var result = await service.SubmitAsync(context.User.UserId(), new(request.ContractVersion, request.ClientAttemptId, quizId, request.QuestionId, request.SelectedOptionId, request.AnswerText), cancellationToken);
        return result.Grade is { } grade
            ? Results.Ok(grade)
            : Error(result.ErrorCode!, result.StatusCode, result.ErrorMessage!, result.Retryable, result.ResetAtUtc, context);
    }

    public static async Task<IResult> History(string? videoId, AssessmentHistoryService service, HttpContext context, CancellationToken cancellationToken) =>
        Results.Ok(new { items = await service.ReadHistoryAsync(context.User.UserId(), videoId, cancellationToken) });

    private static IResult Error(string code, int status, string message, bool retryable, DateTimeOffset? resetAtUtc, HttpContext context)
    {
        if (status == 429 && resetAtUtc is { } reset)
            context.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling((reset - DateTimeOffset.UtcNow).TotalSeconds)).ToString();
        return Results.Json(new ErrorEnvelope(code, status, message, context.TraceIdentifier, retryable, resetAtUtc), statusCode: status);
    }
}

internal sealed record SubmitAnswerRequest(string ContractVersion, string ClientAttemptId, string QuestionId, string? SelectedOptionId, string? AnswerText);
internal sealed record SubmitQuizAttemptRequest(string ContractVersion, string ClientAttemptId, IReadOnlyList<SubmitAttemptAnswerRequest> Answers);
internal sealed record SubmitAttemptAnswerRequest(string QuestionId, string? SelectedOptionId, string? AnswerText);
