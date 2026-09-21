using StudyLens.Api.BuildingBlocks.Errors;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Domain;

namespace StudyLens.Api.Features.SessionQuiz.Api;

internal static class StudySessionEndpoints
{
    public static IResult Start(StartRequest request, StudySessionService service, HttpContext context)
    {
        if (request.Activation.TranscriptSnapshot is not { Status: "available", ContentHash: { Length: > 0 } } snapshot ||
            snapshot.YoutubeVideoId != request.YoutubeVideoId)
        {
            return Results.Json(new ErrorEnvelope(
                "transcriptUnavailable",
                StatusCodes.Status422UnprocessableEntity,
                "A valid uploaded transcript is required before a study session can start.",
                context.TraceIdentifier,
                false), statusCode: StatusCodes.Status422UnprocessableEntity);
        }
        var result = service.Start(new(request.Activation.ActivationId, "active", request.YoutubeVideoId, snapshot.TranscriptSnapshotId, request.Activation.Preferences.QuizIntervalMinutes, request.Activation.Preferences.QuestionType, request.Activation.Preferences.Difficulty));
        return ToResult(result, context);
    }

    public static IResult Complete(string sessionId, CompleteRequest request, StudySessionService service, HttpContext context) =>
        ToResult(service.Complete(new(sessionId, request.ClientCompletionId, request.Reason, request.ActiveStudyMs)), context);

    private static IResult ToResult(StudySessionResult result, HttpContext context) => result.Session is { } session
        ? Results.Ok(new SessionResponse(session.SessionId, session.YoutubeVideoId, session.Status, session.ActiveStudyMs, session.StartedAtUtc, session.CompletedAtUtc))
        : Results.Json(new ErrorEnvelope(result.ErrorCode!, result.StatusCode, result.ErrorMessage!, context.TraceIdentifier, false), statusCode: result.StatusCode);
}

internal sealed record StartRequest(string ContractVersion, string YoutubeVideoId, ActivationRequest Activation);
internal sealed record ActivationRequest(string ActivationId, string Source, string VideoTitle, TranscriptSnapshotRequest? TranscriptSnapshot, PreferenceRequest Preferences);
internal sealed record TranscriptSnapshotRequest(string TranscriptSnapshotId, string YoutubeVideoId, string Language, string Status, string Version, string? ContentHash);
internal sealed record PreferenceRequest(int QuizIntervalMinutes, string QuestionType, string Difficulty);
internal sealed record CompleteRequest(string ContractVersion, string ClientCompletionId, string Reason, long ActiveStudyMs);
internal sealed record SessionResponse(string SessionId, string YoutubeVideoId, string Status, long ActiveStudyMs, DateTimeOffset StartedAtUtc, DateTimeOffset? CompletedAtUtc);
