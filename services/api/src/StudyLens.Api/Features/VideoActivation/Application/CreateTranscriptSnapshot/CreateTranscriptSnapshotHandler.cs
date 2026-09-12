using System.Security.Cryptography;
using System.Text;
using StudyLens.Api.Features.VideoActivation.Domain;
using StudyLens.Api.Features.VideoActivation.Infrastructure;

namespace StudyLens.Api.Features.VideoActivation.Application.CreateTranscriptSnapshot;

internal sealed class CreateTranscriptSnapshotHandler
{
    private readonly ITranscriptSnapshotStore _store;

    public CreateTranscriptSnapshotHandler(ITranscriptSnapshotStore store)
    {
        _store = store;
    }

    public Task<CreateTranscriptSnapshotResult> HandleAsync(
        CreateTranscriptSnapshotCommand command,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var validationError = CreateTranscriptSnapshotValidator.Validate(command, out var status);
        if (validationError is not null)
        {
            return Task.FromResult(new CreateTranscriptSnapshotResult(
                CreateTranscriptSnapshotOutcome.ValidationFailed,
                ErrorCode: "invalidTranscriptSnapshot",
                ErrorMessage: validationError));
        }

        var fingerprint = CreateFingerprint(command);
        var snapshot = new TranscriptSnapshot(
            Guid.NewGuid().ToString(),
            command.YoutubeVideoId,
            command.Language.Trim().ToLowerInvariant(),
            status,
            "1",
            command.ContentHash,
            status == TranscriptSnapshotStatus.Available
                ? command.Cues.Select(cue => new TranscriptCue(
                    Guid.NewGuid().ToString(),
                    cue.StartMs,
                    cue.EndMs,
                    NormalizeText(cue.Text))).ToArray()
                : [],
            fingerprint);

        var stored = _store.GetOrAdd(command.IdempotencyKey, snapshot);
        if (!string.Equals(stored.Snapshot.RequestFingerprint, fingerprint, StringComparison.Ordinal))
        {
            return Task.FromResult(new CreateTranscriptSnapshotResult(
                CreateTranscriptSnapshotOutcome.IdempotencyConflict,
                ErrorCode: "idempotencyConflict",
                ErrorMessage: "The idempotency key was already used with a different payload."));
        }

        return Task.FromResult(new CreateTranscriptSnapshotResult(
            stored.Added ? CreateTranscriptSnapshotOutcome.Created : CreateTranscriptSnapshotOutcome.Replayed,
            stored.Snapshot));
    }

    private static string CreateFingerprint(CreateTranscriptSnapshotCommand command)
    {
        var builder = new StringBuilder()
            .Append(command.YoutubeVideoId).Append('|')
            .Append(command.Language.Trim().ToLowerInvariant()).Append('|')
            .Append(command.Source).Append('|')
            .Append(command.Status.Trim().ToLowerInvariant()).Append('|')
            .Append(command.ContentHash ?? string.Empty);

        foreach (var cue in command.Cues)
        {
            builder.Append('\n')
                .Append(cue.StartMs).Append('|')
                .Append(cue.EndMs).Append('|')
                .Append(NormalizeText(cue.Text));
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(builder.ToString())))
            .ToLowerInvariant();
    }

    private static string NormalizeText(string value) =>
        string.Join(' ', value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}
