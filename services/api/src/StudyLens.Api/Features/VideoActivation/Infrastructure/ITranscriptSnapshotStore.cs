using StudyLens.Api.Features.VideoActivation.Domain;

namespace StudyLens.Api.Features.VideoActivation.Infrastructure;

internal interface ITranscriptSnapshotStore
{
    TranscriptSnapshotStoreResult GetOrAdd(string idempotencyKey, TranscriptSnapshot snapshot);
    TranscriptSnapshot? GetById(string transcriptSnapshotId);
}

internal sealed record TranscriptSnapshotStoreResult(TranscriptSnapshot Snapshot, bool Added);
