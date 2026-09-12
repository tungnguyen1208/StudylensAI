using StudyLens.Api.Features.VideoActivation.Application.Contracts;
using StudyLens.Api.Features.VideoActivation.Domain;

namespace StudyLens.Api.Features.VideoActivation.Infrastructure;

internal sealed class TranscriptSnapshotReader : ITranscriptSnapshotReader
{
    private readonly ITranscriptSnapshotStore _store;

    public TranscriptSnapshotReader(ITranscriptSnapshotStore store)
    {
        _store = store;
    }

    public Task<TranscriptSnapshotForSession?> GetForSessionAsync(
        string transcriptSnapshotId,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var snapshot = _store.GetById(transcriptSnapshotId);
        if (snapshot is null)
        {
            return Task.FromResult<TranscriptSnapshotForSession?>(null);
        }

        var cues = snapshot.Status == TranscriptSnapshotStatus.Available
            ? snapshot.Cues.Select(cue => new TranscriptCueForSession(
                cue.TranscriptCueId,
                cue.StartMs,
                cue.EndMs,
                cue.Text)).ToArray()
            : [];

        return Task.FromResult<TranscriptSnapshotForSession?>(new TranscriptSnapshotForSession(
            snapshot.TranscriptSnapshotId,
            snapshot.YoutubeVideoId,
            snapshot.Language,
            snapshot.Status,
            snapshot.Version,
            snapshot.ContentHash,
            cues));
    }
}
