using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;
using Xunit;

namespace SessionQuiz.Tests;

public sealed class LearningPackageServiceTests
{
    [Fact]
    public async Task Start_CreatesSessionBeforeTranscript_AndReplaysIdempotently()
    {
        await using var fixture = await DatabaseFixture.CreateAsync();
        var service = new LearningPackageService(fixture.Db);
        var command = StartCommand();

        var first = await service.StartAsync(command, CancellationToken.None);
        var replay = await service.StartAsync(command, CancellationToken.None);

        Assert.NotNull(first.Package);
        Assert.Equal(first.Package!.Session.SessionId, replay.Package!.Session.SessionId);
        Assert.Equal("active", first.Package.Session.Status);
        Assert.Equal("waiting", first.Package.Transcript.Status);
        Assert.Equal("notStarted", first.Package.QuizStatus);
        Assert.Single(await fixture.Db.Set<StudySessionEntity>().ToArrayAsync());
        Assert.Single(await fixture.Db.Set<StudyVideoEntity>().ToArrayAsync());
    }

    [Fact]
    public async Task SubmitFullTranscript_ValidatesHash_PersistsCues_AndQueuesOneQuiz()
    {
        await using var fixture = await DatabaseFixture.CreateAsync();
        var service = new LearningPackageService(fixture.Db);
        var started = (await service.StartAsync(StartCommand(), CancellationToken.None)).Package!;
        TranscriptCueView[] cues =
        [
            new(0, 5_000, "  Intro   to networks "),
            new(5_000, 12_000, "IP routes packets."),
        ];
        var normalizedHash = Hash("0|5000|Intro to networks\n5000|12000|IP routes packets.");
        var command = new SubmitFullTranscriptCommand(
            "0.5.0", $"transcript:{started.Session.SessionId}:{normalizedHash}", "dQw4w9WgXcQ",
            "en", "youtubeCaption", "available", normalizedHash, 12_000, cues);

        var accepted = await service.SubmitTranscriptAsync(started.Session.SessionId, command, CancellationToken.None);
        var replay = await service.SubmitTranscriptAsync(started.Session.SessionId, command, CancellationToken.None);

        Assert.Equal("ready", accepted.Package!.Transcript.Status);
        Assert.Equal("youtubeCaption", accepted.Package.Transcript.Source);
        Assert.Equal(2, accepted.Package.Transcript.CueCount);
        Assert.Equal("queued", accepted.Package.QuizStatus);
        Assert.Equal(accepted.Package.Transcript.TranscriptCaptureId, replay.Package!.Transcript.TranscriptCaptureId);
        Assert.Single(await fixture.Db.Set<ProcessingJobEntity>().Where(item => item.JobType == "quizGenerate").ToArrayAsync());

        var conflict = await service.SubmitTranscriptAsync(started.Session.SessionId,
            command with { ContentHash = new string('a', 64), IdempotencyKey = command.IdempotencyKey }, CancellationToken.None);
        Assert.Equal(StatusCodes.Status409Conflict, conflict.StatusCode);
        Assert.Equal("idempotencyConflict", conflict.ErrorCode);
    }

    [Fact]
    public async Task MissingYoutubeCaption_QueuesDurableTranscriptFallback()
    {
        await using var fixture = await DatabaseFixture.CreateAsync();
        var service = new LearningPackageService(fixture.Db);
        var started = (await service.StartAsync(StartCommand(), CancellationToken.None)).Package!;

        var result = await service.SubmitTranscriptAsync(started.Session.SessionId,
            new SubmitFullTranscriptCommand("0.5.0", $"transcript:{started.Session.SessionId}:unavailable", "dQw4w9WgXcQ",
                "und", "youtubeCaption", "unavailable", null, null, []), CancellationToken.None);

        Assert.Equal("generating", result.Package!.Transcript.Status);
        Assert.Equal("notStarted", result.Package.QuizStatus);
        var job = await fixture.Db.Set<ProcessingJobEntity>().SingleAsync();
        Assert.Equal("transcriptGenerate", job.JobType);
        Assert.Equal("queued", job.Status);
        Assert.Equal(3, job.MaxAttempts);
    }

    private static StartLearningSessionCommand StartCommand() => new(
        "0.5.0", "11111111-1111-4111-8111-111111111111", "session:activation-1:dQw4w9WgXcQ",
        "dQw4w9WgXcQ", "Networking lesson", "multipleChoice", "medium");

    private static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private sealed class DatabaseFixture : IAsyncDisposable
    {
        private DatabaseFixture(StudyLensDbContext db) => Db = db;
        public StudyLensDbContext Db { get; }

        public static async Task<DatabaseFixture> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
            var db = new StudyLensDbContext(options);
            await db.Database.OpenConnectionAsync();
            await db.Database.EnsureCreatedAsync();
            return new DatabaseFixture(db);
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
