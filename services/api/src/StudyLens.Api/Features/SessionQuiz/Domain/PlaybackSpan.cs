namespace StudyLens.Api.Features.SessionQuiz.Domain;

public sealed record PlaybackSpan(long StartMs, long EndMs)
{
    public long DurationMs => EndMs - StartMs;

    public bool IsValid => StartMs >= 0 && EndMs > StartMs;

    public bool Overlaps(long startMs, long endMs) => StartMs < endMs && EndMs > startMs;
}
