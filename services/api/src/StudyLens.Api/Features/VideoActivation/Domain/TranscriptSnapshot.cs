namespace StudyLens.Api.Features.VideoActivation.Domain;

internal sealed record TranscriptSnapshot(
    string TranscriptSnapshotId,
    string YoutubeVideoId,
    string Language,
    TranscriptSnapshotStatus Status,
    string Version,
    string? ContentHash,
    IReadOnlyList<TranscriptCue> Cues,
    string RequestFingerprint);
