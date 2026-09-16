using StudyLens.Api.Features.SessionQuiz.Domain;

namespace StudyLens.Api.Features.SessionQuiz.Application.CreateSegment;

public static class CreateSegmentValidator
{
    public static CreateSegmentResult? Validate(CreateSegmentCommand command)
    {
        if (string.IsNullOrWhiteSpace(command.SessionId)
            || string.IsNullOrWhiteSpace(command.ClientSegmentId)
            || string.IsNullOrWhiteSpace(command.IdempotencyKey))
        {
            return CreateSegmentResult.Invalid("invalidSegmentRequest", "Session, client segment and idempotency identifiers are required.");
        }

        if (command.ActiveStudyMs is < 0)
        {
            return CreateSegmentResult.Invalid("invalidSegmentRequest", "Active study time cannot be negative.");
        }

        if (command.PlaybackSpans.Count == 0)
        {
            return CreateSegmentResult.Invalid("invalidPlaybackSpans", "At least one playback span is required.");
        }

        if (command.PlaybackSpans.Any(span => !span.IsValid))
        {
            return CreateSegmentResult.Invalid("invalidPlaybackSpans", "Playback spans must satisfy 0 <= startMs < endMs.");
        }

        return null;
    }
}

// ============================================================
// cue selection
// ============================================================

public static class SegmentCueSelector
{
    public static IReadOnlyList<StudySegmentCue> Select(
        IReadOnlyList<StudySegmentCue> cues,
        IReadOnlyList<PlaybackSpan> spans)
    {
        var selected = new Dictionary<string, StudySegmentCue>();
        foreach (var cue in cues)
        {
            if (cue.EndMs <= cue.StartMs || string.IsNullOrWhiteSpace(cue.Text)) continue;
            if (!spans.Any(span => span.Overlaps(cue.StartMs, cue.EndMs))) continue;
            selected[cue.TranscriptCueId] = cue;
        }

        return selected.Values.OrderBy(cue => cue.StartMs).ThenBy(cue => cue.TranscriptCueId).ToArray();
    }
}
