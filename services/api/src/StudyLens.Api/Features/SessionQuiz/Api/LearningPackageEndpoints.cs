using StudyLens.Api.BuildingBlocks.Errors;
using StudyLens.Api.Features.Accounts.Application;
using StudyLens.Api.Features.SessionQuiz.Application;

namespace StudyLens.Api.Features.SessionQuiz.Api;

internal static class LearningPackageEndpoints
{
    public static async Task<IResult> Start(StartLearningSessionRequest request, LearningPackageService service, HttpContext context, CancellationToken cancellationToken)
    {
        var result = await service.StartAsync(context.User.UserId(), new(request.ContractVersion, request.ActivationId, request.IdempotencyKey,
            request.YoutubeVideoId, request.VideoTitle, request.Preferences.QuestionType, request.Preferences.Difficulty), cancellationToken);
        return result.Package is { } package
            ? Results.Ok(package.Session)
            : Error(result, context);
    }

    public static async Task<IResult> SubmitTranscript(string sessionId, SubmitFullTranscriptRequest request, LearningPackageService service, HttpContext context, CancellationToken cancellationToken) =>
        ToResult(await service.SubmitTranscriptAsync(context.User.UserId(), sessionId, new(request.ContractVersion, request.IdempotencyKey,
            request.YoutubeVideoId, request.Language, request.Source, request.Status, request.ContentHash, request.DurationMs,
            request.Cues.Select(item => new TranscriptCueView(item.StartMs, item.EndMs, item.Text)).ToArray()), cancellationToken), context);

    public static async Task<IResult> Get(string sessionId, LearningPackageService service, HttpContext context, CancellationToken cancellationToken) =>
        ToResult(await service.GetAsync(context.User.UserId(), sessionId, cancellationToken), context);

    public static async Task<IResult> Retry(string sessionId, RetryProcessingRequest request, LearningPackageService service, HttpContext context, CancellationToken cancellationToken) =>
        ToResult(await service.RetryAsync(context.User.UserId(), sessionId, request.ContractVersion, request.Operation, cancellationToken), context);

    public static async Task<IResult> Complete(string sessionId, CompleteLearningSessionRequest request, LearningPackageService service, HttpContext context, CancellationToken cancellationToken)
    {
        var result = await service.CompleteAsync(context.User.UserId(), sessionId,
            new(request.ContractVersion, request.ClientCompletionId, request.Reason), cancellationToken);
        return result.Package is { } package ? Results.Ok(package.Session) : Error(result, context);
    }

    private static IResult ToResult(LearningPackageResult result, HttpContext context) => result.Package is { } package
        ? Results.Ok(package)
        : Error(result, context);

    private static IResult Error(LearningPackageResult result, HttpContext context)
    {
        if (result.StatusCode == StatusCodes.Status429TooManyRequests && result.ResetAtUtc is { } reset)
            context.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling((reset - DateTimeOffset.UtcNow).TotalSeconds)).ToString();
        return Results.Json(new ErrorEnvelope(result.ErrorCode!, result.StatusCode, result.ErrorMessage!, context.TraceIdentifier,
            result.StatusCode >= 500 || result.StatusCode == 429, result.ResetAtUtc), statusCode: result.StatusCode);
    }
}

internal sealed record StartLearningSessionRequest(string ContractVersion, string ActivationId, string IdempotencyKey,
    string YoutubeVideoId, string VideoTitle, PreferenceSnapshotRequest Preferences);
internal sealed record PreferenceSnapshotRequest(string QuestionType, string Difficulty);
internal sealed record SubmitFullTranscriptRequest(string ContractVersion, string IdempotencyKey, string YoutubeVideoId,
    string Language, string Source, string Status, string? ContentHash, long? DurationMs, IReadOnlyList<TranscriptCueRequest> Cues);
internal sealed record TranscriptCueRequest(long StartMs, long EndMs, string Text);
internal sealed record RetryProcessingRequest(string ContractVersion, string Operation);
internal sealed record CompleteLearningSessionRequest(string ContractVersion, string ClientCompletionId, string Reason);
