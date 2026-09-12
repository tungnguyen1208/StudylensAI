namespace StudyLens.Api.Features.VideoActivation.Application.Contracts;

public interface ITranscriptSnapshotReader
{
    Task<TranscriptSnapshotForSession?> GetForSessionAsync(
        string transcriptSnapshotId,
        CancellationToken cancellationToken);
}
