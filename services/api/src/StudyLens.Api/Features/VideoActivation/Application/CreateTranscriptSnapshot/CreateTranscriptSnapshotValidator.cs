using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using StudyLens.Api.Features.VideoActivation.Domain;

namespace StudyLens.Api.Features.VideoActivation.Application.CreateTranscriptSnapshot;

internal static partial class CreateTranscriptSnapshotValidator
{
    public static string? Validate(
        CreateTranscriptSnapshotCommand command,
        out TranscriptSnapshotStatus status)
    {
        status = default;
        if (string.IsNullOrWhiteSpace(command.IdempotencyKey))
        {
            return "idempotencyKey is required.";
        }

        if (!YoutubeVideoIdRegex().IsMatch(command.YoutubeVideoId))
        {
            return "youtubeVideoId must contain exactly 11 valid characters.";
        }

        if (string.IsNullOrWhiteSpace(command.Language) || command.Language.Trim().Length < 2)
        {
            return "language must contain at least two characters.";
        }

        if (!string.Equals(command.Source, "youtubeCaption", StringComparison.Ordinal))
        {
            return "source must be youtubeCaption.";
        }

        if (!Enum.TryParse(command.Status, true, out status))
        {
            return "status must be available, unavailable, or insufficient.";
        }

        if (status == TranscriptSnapshotStatus.Available)
        {
            if (command.ContentHash is null || !ContentHashRegex().IsMatch(command.ContentHash))
            {
                return "contentHash must be a lowercase SHA-256 value for an available transcript.";
            }

            if (command.Cues.Count == 0)
            {
                return "An available transcript must contain at least one cue.";
            }
        }
        else if (command.Cues.Count != 0 || command.ContentHash is not null)
        {
            return "An unavailable or insufficient transcript must not contain cues or contentHash.";
        }

        foreach (var cue in command.Cues)
        {
            if (cue.StartMs < 0 || cue.EndMs <= cue.StartMs || string.IsNullOrWhiteSpace(cue.Text))
            {
                return "Every cue must have valid timestamps and non-empty text.";
            }
        }

        if (status == TranscriptSnapshotStatus.Available &&
            !string.Equals(command.ContentHash, ComputeContentHash(command.Cues), StringComparison.Ordinal))
        {
            return "contentHash does not match the normalized transcript cues.";
        }

        return null;
    }

    private static string ComputeContentHash(IReadOnlyList<CreateTranscriptCue> cues)
    {
        var canonical = string.Join(
            '\n',
            cues.Select(cue => $"{cue.StartMs}|{cue.EndMs}|{NormalizeText(cue.Text)}"));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)))
            .ToLowerInvariant();
    }

    private static string NormalizeText(string value) =>
        string.Join(' ', value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    [GeneratedRegex("^[A-Za-z0-9_-]{11}$", RegexOptions.CultureInvariant)]
    private static partial Regex YoutubeVideoIdRegex();

    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex ContentHashRegex();
}
