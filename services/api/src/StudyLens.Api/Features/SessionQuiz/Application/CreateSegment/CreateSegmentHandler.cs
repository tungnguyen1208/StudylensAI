using System.Security.Cryptography;
using System.Text;
using StudyLens.Api.Features.SessionQuiz.Application.Abstractions;
using StudyLens.Api.Features.SessionQuiz.Domain;
using StudyLens.Api.Features.VideoActivation.Application.Contracts;
using StudyLens.Api.Features.VideoActivation.Domain;

namespace StudyLens.Api.Features.SessionQuiz.Application.CreateSegment;

public sealed class CreateSegmentHandler
{
    private readonly StudySessionService _sessions;
    private readonly ISegmentRepository _segments;
    private readonly ITranscriptCaptureReader _transcripts;
    private readonly TimeProvider _time;

    public CreateSegmentHandler(
        StudySessionService sessions,
        ISegmentRepository segments,
        ITranscriptCaptureReader transcripts,
        TimeProvider? time = null)
    {
        _sessions = sessions;
        _segments = segments;
        _transcripts = transcripts;
        _time = time ?? TimeProvider.System;
    }

    // ============================================================
    // use case
    // ============================================================

    public async Task<CreateSegmentResult> HandleAsync(CreateSegmentCommand command, CancellationToken cancellationToken)
    {
        if (CreateSegmentValidator.Validate(command) is { } invalid) return invalid;

        var session = _sessions.Find(command.SessionId);
        if (session is null) return CreateSegmentResult.NotFound();

        var fingerprint = Fingerprint(command);
        if (_segments.Find(command.SessionId, command.ClientSegmentId) is { } replay)
        {
            return replay.PayloadFingerprint == fingerprint
                ? CreateSegmentResult.Success(replay)
                : CreateSegmentResult.Conflict("segmentConflict", "The same client segment identifier was already used with a different payload.");
        }

        if (session.Status != "active")
        {
            return CreateSegmentResult.Conflict("sessionCompleted", "A completed study session cannot accept new segments.");
        }

        var transcript = await ReadTranscriptAsync(session.TranscriptCaptureId, cancellationToken);
        if (transcript.Error is { } transcriptError) return transcriptError;

        var cues = SegmentCueSelector.Select(transcript.Cues, command.PlaybackSpans);
        if (cues.Count == 0)
        {
            return CreateSegmentResult.Unprocessable("transcriptInsufficient", "No transcript cue overlaps the watched playback spans.");
        }

        var stored = _segments.GetOrAdd(command.SessionId, command.ClientSegmentId, sequenceNumber => new StudySegment(
            Guid.NewGuid().ToString(),
            session.SessionId,
            command.ClientSegmentId,
            session.YoutubeVideoId,
            sequenceNumber,
            command.PlaybackSpans.Min(span => span.StartMs),
            command.PlaybackSpans.Max(span => span.EndMs),
            command.ActiveStudyMs ?? command.PlaybackSpans.Sum(span => span.DurationMs),
            command.PlaybackSpans.OrderBy(span => span.StartMs).ToArray(),
            cues,
            fingerprint,
            _time.GetUtcNow()));

        return stored.PayloadFingerprint == fingerprint
            ? CreateSegmentResult.Success(stored)
            : CreateSegmentResult.Conflict("segmentConflict", "A concurrent request already stored a different payload for this client segment identifier.");
    }

    // ============================================================
    // transcript access through the Dev 1 published port
    // ============================================================

    private async Task<(IReadOnlyList<StudySegmentCue> Cues, CreateSegmentResult? Error)> ReadTranscriptAsync(
        string? transcriptCaptureId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(transcriptCaptureId))
        {
            return ([], CreateSegmentResult.Unprocessable("transcriptUnavailable", "The study session has no transcript capture."));
        }

        var capture = await _transcripts.GetForSessionAsync(transcriptCaptureId, cancellationToken);
        if (capture is null)
        {
            return ([], CreateSegmentResult.Unprocessable("transcriptUnavailable", "The referenced transcript capture was not found."));
        }

        if (capture.Status == "insufficient")
        {
            return ([], CreateSegmentResult.Unprocessable("transcriptInsufficient", "The transcript capture does not contain enough content."));
        }
        if (capture.Status != "available" || capture.Cues.Count == 0)
        {
            return ([], CreateSegmentResult.Unprocessable("transcriptUnavailable", "The transcript capture is not available for segmentation."));
        }

        var cues = capture.Cues
            .Select(cue => new StudySegmentCue(cue.TranscriptCueId, cue.StartMs, cue.EndMs, cue.Text))
            .ToArray();
        return (cues, null);
    }

    // ============================================================
    // idempotency fingerprint
    // ============================================================

    private static string Fingerprint(CreateSegmentCommand command)
    {
        var spans = string.Join('|', command.PlaybackSpans.OrderBy(span => span.StartMs).Select(span => $"{span.StartMs}-{span.EndMs}"));
        var payload = $"{command.IdempotencyKey}#{command.ActiveStudyMs?.ToString() ?? "-"}#{spans}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }
}
