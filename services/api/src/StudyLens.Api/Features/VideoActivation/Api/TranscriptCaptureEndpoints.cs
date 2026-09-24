using System.Security.Cryptography;
using System.Text;
using StudyLens.Api.BuildingBlocks.Errors;
using StudyLens.Api.Features.VideoActivation.Infrastructure;

namespace StudyLens.Api.Features.VideoActivation.Api;

internal static class TranscriptCaptureEndpoints
{
    public static async Task<IResult> Create(CreateTranscriptCaptureRequest request, SqliteTranscriptCaptureStore store, HttpContext context, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.IdempotencyKey) || !YoutubeId(request.YoutubeVideoId) || request.Source != "youtubeCaption" || !ValidStatus(request.Status))
            return Invalid(context, "invalidTranscriptCapture", "A valid caption capture request is required.");
        var cues = (request.Cues ?? []).Select(c => new TranscriptCue(c.StartMs, c.EndMs, c.Text.Trim())).ToArray();
        if (!ValidCues(request.Status, cues) || !ValidHash(request.Status, request.ContentHash, cues)) return Invalid(context, "invalidTranscriptCue", "Caption cues or their content hash are invalid.");
        var replay = await store.FindByCreateKeyAsync(request.IdempotencyKey, cancellationToken);
        if (replay is not null)
        {
            if (!Same(replay, request, cues)) return Conflict(context);
            return Results.Ok(ToRef(replay));
        }
        var entity = new TranscriptCaptureEntity
        {
            TranscriptCaptureId = Guid.NewGuid().ToString(), YoutubeVideoId = request.YoutubeVideoId,
            Language = string.IsNullOrWhiteSpace(request.Language) ? "und" : request.Language.Trim(),
            Source = "youtubeCaption", Status = request.Status, CreateIdempotencyKey = request.IdempotencyKey,
            CreatedAtUtc = DateTimeOffset.UtcNow, Version = 1,
        };
        foreach (var cue in cues) entity.Cues.Add(new TranscriptCaptureCueEntity { TranscriptCueId = Guid.NewGuid().ToString(), TranscriptCaptureId = entity.TranscriptCaptureId, ChunkIndex = 0, StartMs = cue.StartMs, EndMs = cue.EndMs, Text = cue.Text });
        await store.AddAsync(entity, cancellationToken);
        return Results.Ok(ToRef(entity));
    }

    public static async Task<IResult> Get(string captureId, SqliteTranscriptCaptureStore store, HttpContext context, CancellationToken cancellationToken)
    {
        var capture = await store.FindAsync(captureId, cancellationToken);
        if (capture is null) return Results.NotFound(new ErrorEnvelope("transcriptCaptureNotFound", 404, "Transcript capture was not found.", context.TraceIdentifier, false));
        return Results.Ok(new TranscriptCaptureDetails(ToRef(capture), capture.Cues.OrderBy(cue => cue.StartMs).Select(cue => new TranscriptCue(cue.StartMs, cue.EndMs, cue.Text)).ToArray()));
    }

    private static bool Same(TranscriptCaptureEntity stored, CreateTranscriptCaptureRequest request, IReadOnlyList<TranscriptCue> cues) =>
        stored.YoutubeVideoId == request.YoutubeVideoId && stored.Language == (string.IsNullOrWhiteSpace(request.Language) ? "und" : request.Language.Trim()) && stored.Source == request.Source && stored.Status == request.Status && stored.Cues.OrderBy(c => c.StartMs).Select(c => (c.StartMs, c.EndMs, c.Text)).SequenceEqual(cues.OrderBy(c => c.StartMs).Select(c => (c.StartMs, c.EndMs, c.Text)));
    private static bool ValidCues(string status, IReadOnlyList<TranscriptCue> cues) => status switch
    {
        "available" => cues.Count > 0 && cues.All(c => c.StartMs >= 0 && c.EndMs > c.StartMs && !string.IsNullOrWhiteSpace(c.Text)),
        "unavailable" or "insufficient" => cues.Count == 0,
        _ => false,
    };
    private static bool ValidHash(string status, string? contentHash, IReadOnlyList<TranscriptCue> cues)
    {
        if (status is "unavailable" or "insufficient") return string.IsNullOrWhiteSpace(contentHash);
        if (string.IsNullOrWhiteSpace(contentHash) || contentHash.Length != 64 || !contentHash.All(Uri.IsHexDigit)) return false;
        var canonical = string.Join("\n", cues.Select(c => $"{c.StartMs}|{c.EndMs}|{c.Text}"));
        return string.Equals(contentHash, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))), StringComparison.OrdinalIgnoreCase);
    }
    private static bool ValidStatus(string status) => status is "available" or "unavailable" or "insufficient";
    private static TranscriptCaptureRef ToRef(TranscriptCaptureEntity capture) => new(capture.TranscriptCaptureId, capture.YoutubeVideoId, capture.Language, capture.Source, capture.Status, capture.Cues.Count, capture.Version);
    private static bool YoutubeId(string value) => value.Length == 11 && value.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-');
    private static IResult Invalid(HttpContext context, string code, string message) => Results.BadRequest(new ErrorEnvelope(code, 400, message, context.TraceIdentifier, false));
    private static IResult Conflict(HttpContext context) => Results.Json(new ErrorEnvelope("idempotencyConflict", 409, "The idempotency key was already used with a different payload.", context.TraceIdentifier, false), statusCode: 409);
}

internal sealed record CreateTranscriptCaptureRequest(string IdempotencyKey, string YoutubeVideoId, string? Language, string Source, string Status, string? ContentHash, IReadOnlyList<TranscriptCue>? Cues);
internal sealed record TranscriptCaptureRef(string TranscriptCaptureId, string YoutubeVideoId, string Language, string Source, string Status, int AvailableCueCount, int Version);
internal sealed record TranscriptCue(long StartMs, long EndMs, string Text);
internal sealed record TranscriptCaptureDetails(TranscriptCaptureRef Capture, IReadOnlyList<TranscriptCue> Cues);
