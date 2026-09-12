using StudyLens.Api.Features.VideoActivation.Domain;

namespace StudyLens.Api.Features.VideoActivation.Application.Contracts;

public sealed record TranscriptSnapshotForSession(
    string TranscriptSnapshotId,
    string YoutubeVideoId,
    string Language,
    TranscriptSnapshotStatus Status,
    string Version,
    string? ContentHash,
    IReadOnlyList<TranscriptCueForSession> Cues);

public sealed record TranscriptCueForSession(
    string TranscriptCueId,
    long StartMs,
    long EndMs,
    string Text);
