namespace StudyLens.Api.Features.VideoActivation.Application.CreateTranscriptSnapshot;

internal sealed record CreateTranscriptSnapshotCommand(
    string IdempotencyKey,
    string YoutubeVideoId,
    string Language,
    string Source,
    string Status,
    string? ContentHash,
    IReadOnlyList<CreateTranscriptCue> Cues);

internal sealed record CreateTranscriptCue(long StartMs, long EndMs, string Text);
