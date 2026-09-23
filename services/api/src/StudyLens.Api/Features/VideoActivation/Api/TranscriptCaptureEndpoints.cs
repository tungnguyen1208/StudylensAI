using System.Security.Cryptography;
using System.Text;
using StudyLens.Api.BuildingBlocks.Errors;
using StudyLens.Api.Features.VideoActivation.Application.Transcription;
using StudyLens.Api.Features.VideoActivation.Infrastructure;

namespace StudyLens.Api.Features.VideoActivation.Api;

internal static class TranscriptCaptureEndpoints
{
    public static async Task<IResult> Create(CreateTranscriptCaptureRequest request, SqliteTranscriptCaptureStore store, HttpContext context, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.IdempotencyKey) || !YoutubeId(request.YoutubeVideoId)) return Invalid(context, "invalidTranscriptCapture", "A valid idempotency key and YouTube video ID are required.");
        var replay = await store.FindByCreateKeyAsync(request.IdempotencyKey, cancellationToken);
        if (replay is not null)
        {
            if (replay.YoutubeVideoId != request.YoutubeVideoId) return Conflict(context);
            return Results.Ok(ToRef(replay));
        }
        var entity = new TranscriptCaptureEntity { TranscriptCaptureId = Guid.NewGuid().ToString(), YoutubeVideoId = request.YoutubeVideoId, Language = string.IsNullOrWhiteSpace(request.LanguageHint) ? "und" : request.LanguageHint, CreateIdempotencyKey = request.IdempotencyKey, CreatedAtUtc = DateTimeOffset.UtcNow };
        await store.AddAsync(entity, cancellationToken);
        return Results.Ok(ToRef(entity));
    }

    public static async Task<IResult> Append(string captureId, HttpRequest request, SqliteTranscriptCaptureStore store, IAudioTranscriptionGateway transcription, HttpContext context, CancellationToken cancellationToken)
    {
        if (!request.HasFormContentType) return Invalid(context, "invalidAudioChunk", "Audio chunks must use multipart form data.");
        var form = await request.ReadFormAsync(cancellationToken);
        var key = form["idempotencyKey"].ToString();
        var audio = form.Files.GetFile("audio");
        if (!int.TryParse(form["chunkIndex"], out var index) || !long.TryParse(form["startMs"], out var startMs) || !long.TryParse(form["endMs"], out var endMs) || startMs < 0 || endMs <= startMs || audio is null || string.IsNullOrWhiteSpace(key)) return Invalid(context, "invalidAudioChunk", "Audio chunk metadata is invalid.");
        var capture = await store.FindAsync(captureId, cancellationToken);
        if (capture is null) return Results.NotFound(new ErrorEnvelope("transcriptCaptureNotFound", 404, "Transcript capture was not found.", context.TraceIdentifier, false));
        var fingerprint = Hash($"{captureId}|{index}|{startMs}|{endMs}|{audio.Length}|{audio.ContentType}");
        var replay = await store.FindChunkAsync(key, cancellationToken);
        if (replay is not null)
        {
            if (replay.PayloadFingerprint != fingerprint) return Conflict(context);
            return Results.Ok(new TranscriptCaptureProgress(ToRef(capture), capture.Cues.Count, replay.ChunkIndex));
        }
        AudioTranscriptionResult result;
        try { await using var stream = audio.OpenReadStream(); result = await transcription.TranscribeAsync(stream, audio.FileName, audio.ContentType ?? "audio/webm", startMs, endMs, cancellationToken); }
        catch (OperationCanceledException) { throw; }
        catch (Exception) { return Results.Json(new ErrorEnvelope("sttProviderFailed", 502, "Audio transcription provider is unavailable. Please retry.", context.TraceIdentifier, true), statusCode: 502); }
        var cues = result.Cues.Where(cue => cue.StartMs >= startMs && cue.EndMs > cue.StartMs && !string.IsNullOrWhiteSpace(cue.Text)).ToArray();
        if (cues.Length == 0) return Results.Json(new ErrorEnvelope("sttInvalidResponse", 502, "Audio transcription returned no valid cues.", context.TraceIdentifier, true), statusCode: 502);
        capture.Language = result.Language;
        capture.Status = "available";
        capture.Version++;
        capture.Chunks.Add(new TranscriptAudioChunkEntity { TranscriptAudioChunkId = Guid.NewGuid().ToString(), TranscriptCaptureId = captureId, IdempotencyKey = key, PayloadFingerprint = fingerprint, ChunkIndex = index, StartMs = startMs, EndMs = endMs, AcceptedAtUtc = DateTimeOffset.UtcNow });
        foreach (var cue in cues) capture.Cues.Add(new TranscriptCaptureCueEntity { TranscriptCueId = Guid.NewGuid().ToString(), TranscriptCaptureId = captureId, ChunkIndex = index, StartMs = cue.StartMs, EndMs = cue.EndMs, Text = cue.Text.Trim() });
        await store.SaveAsync(cancellationToken);
        return Results.Ok(new TranscriptCaptureProgress(ToRef(capture), capture.Cues.Count, index));
    }

    public static async Task<IResult> Get(string captureId, SqliteTranscriptCaptureStore store, HttpContext context, CancellationToken cancellationToken)
    {
        var capture = await store.FindAsync(captureId, cancellationToken);
        if (capture is null)
            return Results.NotFound(new ErrorEnvelope("transcriptCaptureNotFound", 404, "Transcript capture was not found.", context.TraceIdentifier, false));

        var cues = capture.Cues
            .OrderBy(cue => cue.StartMs)
            .Select(cue => new TranscriptCue(cue.StartMs, cue.EndMs, cue.Text))
            .ToArray();
        return Results.Ok(new TranscriptCaptureDetails(ToRef(capture), cues));
    }

    private static TranscriptCaptureRef ToRef(TranscriptCaptureEntity capture) => new(capture.TranscriptCaptureId, capture.YoutubeVideoId, capture.Language, capture.Source, capture.Status, capture.Cues.Count, capture.Version);
    private static bool YoutubeId(string value) => value.Length == 11 && value.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-');
    private static string Hash(string input) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input))).ToLowerInvariant();
    private static IResult Invalid(HttpContext context, string code, string message) => Results.BadRequest(new ErrorEnvelope(code, 400, message, context.TraceIdentifier, false));
    private static IResult Conflict(HttpContext context) => Results.Json(new ErrorEnvelope("idempotencyConflict", 409, "The idempotency key was already used with a different payload.", context.TraceIdentifier, false), statusCode: 409);
}

internal sealed record CreateTranscriptCaptureRequest(string IdempotencyKey, string YoutubeVideoId, string? LanguageHint);
internal sealed record TranscriptCaptureRef(string TranscriptCaptureId, string YoutubeVideoId, string Language, string Source, string Status, int AvailableCueCount, int Version);
internal sealed record TranscriptCaptureProgress(TranscriptCaptureRef Capture, int CueCount, int AcceptedChunkIndex);
internal sealed record TranscriptCue(long StartMs, long EndMs, string Text);
internal sealed record TranscriptCaptureDetails(TranscriptCaptureRef Capture, IReadOnlyList<TranscriptCue> Cues);
