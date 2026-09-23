using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace StudyLens.Api.Features.VideoActivation.Application.Transcription;

internal sealed class AiAudioTranscriptionClient : IAudioTranscriptionGateway
{
    private readonly HttpClient _client;
    public AiAudioTranscriptionClient(HttpClient client) => _client = client;

    public async Task<AudioTranscriptionResult> TranscribeAsync(Stream audio, string fileName, string mimeType, long startMs, long endMs, CancellationToken cancellationToken)
    {
        using var content = new MultipartFormDataContent();
        using var audioContent = new StreamContent(audio);
        audioContent.Headers.ContentType = MediaTypeHeaderValue.Parse(mimeType);
        content.Add(audioContent, "audio", fileName);
        content.Add(new StringContent(startMs.ToString()), "startMs");
        content.Add(new StringContent(endMs.ToString()), "endMs");
        using var response = await _client.PostAsync("api/transcriptions", content, cancellationToken);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException("AI transcription provider failed.", null, response.StatusCode);
        var value = await response.Content.ReadFromJsonAsync<AiTranscriptionResponse>(cancellationToken: cancellationToken);
        if (value is null || string.IsNullOrWhiteSpace(value.Language) || value.Cues is null) throw new InvalidOperationException("AI transcription response was invalid.");
        return new AudioTranscriptionResult(value.Language, value.Cues.Select(item => new TranscribedCue(item.StartMs, item.EndMs, item.Text)).ToArray());
    }

    private sealed record AiTranscriptionResponse(string Language, IReadOnlyList<AiCue> Cues);
    private sealed record AiCue(long StartMs, long EndMs, string Text);
}
