using StudyLens.Api.Features.SessionQuiz.Domain;

namespace StudyLens.Api.Features.SessionQuiz.Application.CreateSegment;

public sealed record CreateSegmentCommand(
    string SessionId,
    string ClientSegmentId,
    string IdempotencyKey,
    long? ActiveStudyMs,
    IReadOnlyList<PlaybackSpan> PlaybackSpans);

public sealed record CreateSegmentResult(
    StudySegment? Segment,
    string? ErrorCode,
    string? ErrorMessage,
    int StatusCode,
    bool Retryable = false)
{
    public static CreateSegmentResult Success(StudySegment segment) => new(segment, null, null, StatusCodes.Status200OK);

    public static CreateSegmentResult Invalid(string code, string message) => new(null, code, message, StatusCodes.Status400BadRequest);

    public static CreateSegmentResult Unprocessable(string code, string message) => new(null, code, message, StatusCodes.Status422UnprocessableEntity);

    public static CreateSegmentResult Conflict(string code, string message) => new(null, code, message, StatusCodes.Status409Conflict);

    public static CreateSegmentResult NotFound() => new(null, "sessionNotFound", "Study session was not found.", StatusCodes.Status404NotFound);
}
