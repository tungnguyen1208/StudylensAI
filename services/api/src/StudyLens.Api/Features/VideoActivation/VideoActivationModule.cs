using StudyLens.Api.Features.VideoActivation.Application.Contracts;
using StudyLens.Api.Features.VideoActivation.Application.CreateTranscriptSnapshot;
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
        return services;
    }

    public static IEndpointRouteBuilder MapVideoActivationEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        return endpoints;
    }
}
