using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StudyLens.Api.Features.VideoActivation;
using StudyLens.Api.Features.VideoActivation.Api;
using StudyLens.Api.Features.VideoActivation.Application.Contracts;
using StudyLens.Api.Features.VideoActivation.Application.CreateTranscriptSnapshot;
using StudyLens.Api.Features.VideoActivation.Domain;
using Xunit;

namespace VideoActivation.Tests;

public class VideoActivationModuleTests
{
    private const string VideoId = "dQw4w9WgXcQ";
    private const string ContentHash = "419fedf08da0041723c3c9928e9568d3420a8ec3227c48697938546a8f514373";

    [Fact]
    public void AddVideoActivationModule_ShouldRegisterPublicTranscriptReader()
    {
        using var provider = CreateProvider();

        Assert.NotNull(provider.GetRequiredService<ITranscriptSnapshotReader>());
    }

    [Fact]
    public async Task CreateTranscriptSnapshot_ShouldReplayIdenticalIdempotentRequest()
    {
        using var provider = CreateProvider();
        var handler = provider.GetRequiredService<CreateTranscriptSnapshotHandler>();
        var command = CreateAvailableCommand("transcript:stable-key");

        var first = await handler.HandleAsync(command, CancellationToken.None);
        var replay = await handler.HandleAsync(command, CancellationToken.None);

        Assert.Equal(CreateTranscriptSnapshotOutcome.Created, first.Outcome);
        Assert.Equal(CreateTranscriptSnapshotOutcome.Replayed, replay.Outcome);
        Assert.Equal(first.Snapshot!.TranscriptSnapshotId, replay.Snapshot!.TranscriptSnapshotId);
    }

    [Fact]
    public async Task CreateTranscriptSnapshot_ShouldRejectConflictingIdempotencyReplay()
    {
        using var provider = CreateProvider();
        var handler = provider.GetRequiredService<CreateTranscriptSnapshotHandler>();
        var first = CreateAvailableCommand("transcript:conflict-key");
        var conflicting = first with
        {
            ContentHash = "f8a8603f0172dda7a34610210b0e0752c3d403194cc64260b6d30d2e3fe9fbad",
            Cues = [new CreateTranscriptCue(1000, 5000, "Different normalized transcript content.")]
        };

        await handler.HandleAsync(first, CancellationToken.None);
        var result = await handler.HandleAsync(conflicting, CancellationToken.None);

        Assert.Equal(CreateTranscriptSnapshotOutcome.IdempotencyConflict, result.Outcome);
        Assert.Equal("idempotencyConflict", result.ErrorCode);
        Assert.Null(result.Snapshot);
    }

    [Fact]
    public async Task CreateTranscriptSnapshot_ShouldValidateAvailabilityInvariants()
    {
        using var provider = CreateProvider();
        var handler = provider.GetRequiredService<CreateTranscriptSnapshotHandler>();
        var command = CreateAvailableCommand("transcript:invalid-key") with { Cues = [] };

        var result = await handler.HandleAsync(command, CancellationToken.None);

        Assert.Equal(CreateTranscriptSnapshotOutcome.ValidationFailed, result.Outcome);
        Assert.Equal("invalidTranscriptSnapshot", result.ErrorCode);
    }

    [Fact]
    public async Task CreateTranscriptSnapshot_ShouldRejectMismatchedContentHash()
    {
        using var provider = CreateProvider();
        var handler = provider.GetRequiredService<CreateTranscriptSnapshotHandler>();
        var command = CreateAvailableCommand("transcript:mismatched-hash") with
        {
            ContentHash = new string('0', 64)
        };

        var result = await handler.HandleAsync(command, CancellationToken.None);

        Assert.Equal(CreateTranscriptSnapshotOutcome.ValidationFailed, result.Outcome);
        Assert.Contains("does not match", result.ErrorMessage);
    }

    [Fact]
    public async Task Endpoint_ShouldReturnSafeErrorForMalformedJson()
    {
        using var provider = CreateProvider();
        var context = new DefaultHttpContext
        {
            RequestServices = provider
        };
        context.Request.ContentType = "application/json";
        context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes("{ invalid json"));

        var result = await CreateTranscriptSnapshotEndpoint.HandleAsync(
            context,
            provider.GetRequiredService<CreateTranscriptSnapshotHandler>(),
            CancellationToken.None);

        var statusResult = Assert.IsAssignableFrom<IStatusCodeHttpResult>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, statusResult.StatusCode);
    }

    [Fact]
    public async Task TranscriptReader_ShouldReturnImmutableSessionShape()
    {
        using var provider = CreateProvider();
        var handler = provider.GetRequiredService<CreateTranscriptSnapshotHandler>();
        var reader = provider.GetRequiredService<ITranscriptSnapshotReader>();
        var created = await handler.HandleAsync(
            CreateAvailableCommand("transcript:reader-key"),
            CancellationToken.None);

        var snapshot = await reader.GetForSessionAsync(
            created.Snapshot!.TranscriptSnapshotId,
            CancellationToken.None);

        Assert.NotNull(snapshot);
        Assert.Equal(TranscriptSnapshotStatus.Available, snapshot.Status);
        Assert.Equal(ContentHash, snapshot.ContentHash);
        Assert.Single(snapshot.Cues);
        Assert.Equal("A normalized transcript cue.", snapshot.Cues[0].Text);
    }

    [Theory]
    [InlineData("unavailable", TranscriptSnapshotStatus.Unavailable)]
    [InlineData("insufficient", TranscriptSnapshotStatus.Insufficient)]
    public async Task TranscriptReader_ShouldReturnNoCuesForUnavailableStates(
        string contractStatus,
        TranscriptSnapshotStatus expectedStatus)
    {
        using var provider = CreateProvider();
        var handler = provider.GetRequiredService<CreateTranscriptSnapshotHandler>();
        var reader = provider.GetRequiredService<ITranscriptSnapshotReader>();
        var command = new CreateTranscriptSnapshotCommand(
            $"transcript:{contractStatus}",
            VideoId,
            "und",
            "youtubeCaption",
            contractStatus,
            null,
            []);

        var created = await handler.HandleAsync(command, CancellationToken.None);
        var snapshot = await reader.GetForSessionAsync(
            created.Snapshot!.TranscriptSnapshotId,
            CancellationToken.None);

        Assert.NotNull(snapshot);
        Assert.Equal(expectedStatus, snapshot.Status);
        Assert.Empty(snapshot.Cues);
    }

    private static ServiceProvider CreateProvider()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();
        services.AddVideoActivationModule(configuration);
        return services.BuildServiceProvider();
    }

    private static CreateTranscriptSnapshotCommand CreateAvailableCommand(string idempotencyKey) =>
        new(
            idempotencyKey,
            VideoId,
            "vi",
            "youtubeCaption",
            "available",
            ContentHash,
            [new CreateTranscriptCue(1000, 4200, "  A normalized   transcript cue.  ")]);
}
