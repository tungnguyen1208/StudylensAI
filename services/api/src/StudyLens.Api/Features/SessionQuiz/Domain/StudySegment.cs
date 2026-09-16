namespace StudyLens.Api.Features.SessionQuiz.Domain;

public sealed record StudySegment(
    string SegmentId,
    string SessionId,
    string ClientSegmentId,
    string YoutubeVideoId,
    int SequenceNumber,
    long StartMs,
    long EndMs,
    long ActiveStudyMs,
    IReadOnlyList<PlaybackSpan> PlaybackSpans,
    IReadOnlyList<StudySegmentCue> TranscriptCues,
    string PayloadFingerprint,
    DateTimeOffset CreatedAtUtc);

public sealed record StudySegmentCue(
    string TranscriptCueId,
    long StartMs,
    long EndMs,
    string Text);
