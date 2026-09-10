using System.Collections.Concurrent;
using StudyLens.Api.Features.VideoActivation.Domain;

namespace StudyLens.Api.Features.VideoActivation.Infrastructure;

internal sealed class InMemoryTranscriptSnapshotStore : ITranscriptSnapshotStore
{
    private readonly ConcurrentDictionary<string, TranscriptSnapshot> _byIdempotencyKey = new();
    private readonly ConcurrentDictionary<string, TranscriptSnapshot> _byId = new();

    public TranscriptSnapshotStoreResult GetOrAdd(
        string idempotencyKey,
        TranscriptSnapshot snapshot)
    {
        var stored = _byIdempotencyKey.GetOrAdd(idempotencyKey, snapshot);
        var added = ReferenceEquals(stored, snapshot);
        if (added)
        {
            _byId.TryAdd(snapshot.TranscriptSnapshotId, snapshot);
        }

        return new TranscriptSnapshotStoreResult(stored, added);
    }

    public TranscriptSnapshot? GetById(string transcriptSnapshotId) =>
        _byId.TryGetValue(transcriptSnapshotId, out var snapshot) ? snapshot : null;
}
