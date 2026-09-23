namespace StudyLens.Api.Features.VideoActivation.Application.Transcription;

public sealed record TranscribedCue(long StartMs, long EndMs, string Text);
public sealed record AudioTranscriptionResult(string Language, IReadOnlyList<TranscribedCue> Cues);

public interface IAudioTranscriptionGateway
{
    Task<AudioTranscriptionResult> TranscribeAsync(Stream audio, string fileName, string mimeType, long startMs, long endMs, CancellationToken cancellationToken);
}
