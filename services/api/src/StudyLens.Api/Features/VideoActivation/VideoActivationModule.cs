using StudyLens.Api.Features.VideoActivation.Api;
using StudyLens.Api.Features.VideoActivation.Application.Contracts;
using StudyLens.Api.Features.VideoActivation.Application.CreateTranscriptSnapshot;
using StudyLens.Api.Features.VideoActivation.Application.Transcription;
using StudyLens.Api.Features.VideoActivation.Infrastructure;

namespace StudyLens.Api.Features.VideoActivation;

public static class VideoActivationModule
{
    public static IServiceCollection AddVideoActivationModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddSingleton<ITranscriptSnapshotStore, InMemoryTranscriptSnapshotStore>();
        services.AddSingleton<CreateTranscriptSnapshotHandler>();
        services.AddSingleton<ITranscriptSnapshotReader, TranscriptSnapshotReader>();
        services.AddScoped<SqliteTranscriptCaptureStore>();
        services.AddScoped<ITranscriptCaptureReader>(provider => provider.GetRequiredService<SqliteTranscriptCaptureStore>());
        services.AddHttpClient<IAudioTranscriptionGateway, AiAudioTranscriptionClient>((provider, client) =>
        {
            var baseUrl = configuration["AiService:BaseUrl"] ?? "http://localhost:8000";
            client.BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/");
            client.Timeout = TimeSpan.FromSeconds(45);
        });
        return services;
    }

    public static IEndpointRouteBuilder MapVideoActivationEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(
                "/api/video-activation/transcript-snapshots",
                CreateTranscriptSnapshotEndpoint.HandleAsync)
            .WithName("CreateTranscriptSnapshot")
            .WithTags("Video Activation");
        endpoints.MapPost("/api/video-activation/transcript-captures", TranscriptCaptureEndpoints.Create)
            .WithName("CreateTranscriptCapture").WithTags("Video Activation");
        endpoints.MapPost("/api/video-activation/transcript-captures/{captureId}/audio-chunks", TranscriptCaptureEndpoints.Append)
            .WithName("AppendTranscriptAudioChunk").WithTags("Video Activation");
        endpoints.MapGet("/api/video-activation/transcript-captures/{captureId}", TranscriptCaptureEndpoints.Get)
            .WithName("GetTranscriptCaptureDetails").WithTags("Video Activation");
        return endpoints;
    }
}
