namespace StudyLens.Api.Features.VideoActivation.Domain;

internal sealed record TranscriptCue(
    string TranscriptCueId,
    long StartMs,
    long EndMs,
    string Text);
