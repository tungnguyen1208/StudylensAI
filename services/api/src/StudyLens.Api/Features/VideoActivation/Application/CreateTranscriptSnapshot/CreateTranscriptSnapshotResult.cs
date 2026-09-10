using StudyLens.Api.Features.VideoActivation.Domain;

namespace StudyLens.Api.Features.VideoActivation.Application.CreateTranscriptSnapshot;

internal enum CreateTranscriptSnapshotOutcome
{
    Created,
    Replayed,
    ValidationFailed,
    IdempotencyConflict
}

internal sealed record CreateTranscriptSnapshotResult(
    CreateTranscriptSnapshotOutcome Outcome,
    TranscriptSnapshot? Snapshot = null,
    string? ErrorCode = null,
    string? ErrorMessage = null);
