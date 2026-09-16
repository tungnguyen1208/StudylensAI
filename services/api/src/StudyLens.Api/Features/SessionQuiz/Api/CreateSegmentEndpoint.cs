using StudyLens.Api.BuildingBlocks.Errors;
using StudyLens.Api.Features.SessionQuiz.Application.CreateSegment;
using StudyLens.Api.Features.SessionQuiz.Domain;

namespace StudyLens.Api.Features.SessionQuiz.Api;

internal static class CreateSegmentEndpoint
{
    public static async Task<IResult> HandleAsync(
        string sessionId,
        CreateSegmentRequest request,
        CreateSegmentHandler handler,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var spans = (request.PlaybackSpans ?? [])
            .Select(span => new PlaybackSpan(span.StartMs, span.EndMs))
            .ToArray();

        var result = await handler.HandleAsync(
            new CreateSegmentCommand(sessionId, request.ClientSegmentId, request.IdempotencyKey, request.ActiveStudyMs, spans),
            cancellationToken);

        return result.Segment is { } segment
            ? Results.Ok(new StudySegmentRefResponse(segment.SegmentId, segment.SessionId, segment.YoutubeVideoId, segment.StartMs, segment.EndMs))
            : Results.Json(
                new ErrorEnvelope(result.ErrorCode!, result.StatusCode, result.ErrorMessage!, context.TraceIdentifier, result.Retryable),
                statusCode: result.StatusCode);
    }
}

internal sealed record CreateSegmentRequest(
    string ContractVersion,
    string ClientSegmentId,
    string IdempotencyKey,
    long? ActiveStudyMs,
    IReadOnlyList<PlaybackSpanRequest>? PlaybackSpans);

internal sealed record PlaybackSpanRequest(long StartMs, long EndMs);

internal sealed record StudySegmentRefResponse(
    string SegmentId,
    string SessionId,
    string YoutubeVideoId,
    long StartMs,
    long EndMs);
