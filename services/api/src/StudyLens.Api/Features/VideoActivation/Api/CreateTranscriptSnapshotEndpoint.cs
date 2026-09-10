using System.Text.Json;
using StudyLens.Api.BuildingBlocks.Errors;
using StudyLens.Api.Features.VideoActivation.Application.CreateTranscriptSnapshot;
using StudyLens.Api.Features.VideoActivation.Domain;

namespace StudyLens.Api.Features.VideoActivation.Api;

internal static class CreateTranscriptSnapshotEndpoint
{
    public static async Task<IResult> HandleAsync(
        HttpContext httpContext,
        CreateTranscriptSnapshotHandler handler,
        CancellationToken cancellationToken)
    {
        CreateTranscriptSnapshotRequest? request;
        try
        {
            request = await httpContext.Request.ReadFromJsonAsync<CreateTranscriptSnapshotRequest>(
                cancellationToken);
        }
        catch (JsonException)
        {
            return InvalidJson(httpContext);
        }
        catch (NotSupportedException)
        {
            return InvalidJson(httpContext);
        }

        if (request is null || request.Cues is null)
        {
            return InvalidJson(httpContext);
        }

        var command = new CreateTranscriptSnapshotCommand(
            request.IdempotencyKey,
            request.YoutubeVideoId,
            request.Language,
            request.Source,
            request.Status,
            request.ContentHash,
            request.Cues.Select(cue => new CreateTranscriptCue(cue.StartMs, cue.EndMs, cue.Text)).ToArray());

        var result = await handler.HandleAsync(command, cancellationToken);
        if (result.Outcome == CreateTranscriptSnapshotOutcome.ValidationFailed)
        {
            return Results.BadRequest(CreateError(result, StatusCodes.Status400BadRequest, httpContext));
        }

        if (result.Outcome == CreateTranscriptSnapshotOutcome.IdempotencyConflict)
        {
            return Results.Conflict(CreateError(result, StatusCodes.Status409Conflict, httpContext));
        }

        var snapshot = result.Snapshot!;
        return Results.Ok(new TranscriptSnapshotResponse(
            snapshot.TranscriptSnapshotId,
            snapshot.YoutubeVideoId,
            snapshot.Language,
            ToContractStatus(snapshot.Status),
            snapshot.ContentHash,
            snapshot.Version));
    }

    private static IResult InvalidJson(HttpContext context) =>
        Results.BadRequest(new ErrorEnvelope(
            "invalidJson",
            StatusCodes.Status400BadRequest,
            "Request body must be valid JSON and include the required fields.",
            context.TraceIdentifier,
            false));

    private static ErrorEnvelope CreateError(
        CreateTranscriptSnapshotResult result,
        int status,
        HttpContext context) =>
        new(
            result.ErrorCode ?? "transcriptSnapshotError",
            status,
            result.ErrorMessage ?? "Transcript snapshot request failed.",
            context.TraceIdentifier,
            false);

    private static string ToContractStatus(TranscriptSnapshotStatus status) => status switch
    {
        TranscriptSnapshotStatus.Available => "available",
        TranscriptSnapshotStatus.Unavailable => "unavailable",
        TranscriptSnapshotStatus.Insufficient => "insufficient",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, null)
    };
}

internal sealed record CreateTranscriptSnapshotRequest(
    string IdempotencyKey,
    string YoutubeVideoId,
    string Language,
    string Source,
    string Status,
    string? ContentHash,
    IReadOnlyList<TranscriptCueRequest>? Cues);

internal sealed record TranscriptCueRequest(long StartMs, long EndMs, string Text);

internal sealed record TranscriptSnapshotResponse(
    string TranscriptSnapshotId,
    string YoutubeVideoId,
    string Language,
    string Status,
    string? ContentHash,
    string Version);
