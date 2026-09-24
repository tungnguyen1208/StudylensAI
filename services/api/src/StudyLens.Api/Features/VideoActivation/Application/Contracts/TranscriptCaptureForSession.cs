namespace StudyLens.Api.Features.VideoActivation.Application.Contracts;

public sealed record TranscriptCaptureForSession(
    string TranscriptCaptureId,
    string YoutubeVideoId,
    string Language,
    string Status,
    int Version,
    IReadOnlyList<TranscriptCueForSession> Cues);

public interface ITranscriptCaptureReader
{
    Task<TranscriptCaptureForSession?> GetForSessionAsync(string transcriptCaptureId, CancellationToken cancellationToken);
}
