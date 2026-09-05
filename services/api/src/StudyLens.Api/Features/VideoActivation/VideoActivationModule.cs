namespace StudyLens.Api.Features.VideoActivation;

public static class VideoActivationModule
{
    public static IServiceCollection AddVideoActivationModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Dev 1 will register VideoActivation services, repositories, and handlers here.
        return services;
    }

    public static IEndpointRouteBuilder MapVideoActivationEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        // Dev 1 will map endpoints for video detection, classification orchestration, and preferences here.
        return endpoints;
    }
}
