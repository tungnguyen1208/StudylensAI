using System.Text.Json;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Application.CreateSegment;
using StudyLens.Api.Features.SessionQuiz.Domain;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Features.VideoActivation.Application.Contracts;
using StudyLens.Api.Features.VideoActivation.Domain;
using Xunit;

namespace SessionQuiz.Tests;

public class CreateSegmentHandlerTests
{
    // ============================================================
    // cue selection driven by transcript fixtures
    // ============================================================

    [Fact]
    public async Task SelectsOnlyCuesOverlappingWatchedSpansForSeekAndReplay()
    {
        var fixture = SegmentFixtures.Load("playback-spans-seek-replay.json");
        var transcript = SegmentFixtures.Transcript("transcript-valid-multi-cue.json");
        var context = SegmentTestContext.WithTranscript(transcript);

        var result = await context.CreateAsync(SegmentFixtures.Spans(fixture), activeStudyMs: SegmentFixtures.ActiveStudyMs(fixture));

        Assert.NotNull(result.Segment);
        Assert.Equal(SegmentFixtures.ExpectedCueIds(fixture), result.Segment!.TranscriptCues.Select(cue => cue.TranscriptCueId));
        Assert.Equal(0, result.Segment.StartMs);
        Assert.Equal(180000, result.Segment.EndMs);
        Assert.Equal(150000, result.Segment.ActiveStudyMs);
        Assert.Equal(1, result.Segment.SequenceNumber);
    }

    [Fact]
    public async Task ExcludesCuesTouchingTheSpanEndAndCuesOutsideEverySpan()
    {
        var fixture = SegmentFixtures.Load("transcript-boundary-cues.json");
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-boundary-cues.json"));

        var result = await context.CreateAsync(SegmentFixtures.Spans(fixture));

        Assert.Equal(SegmentFixtures.ExpectedCueIds(fixture), result.Segment!.TranscriptCues.Select(cue => cue.TranscriptCueId));
    }

    [Fact]
    public async Task DeduplicatesReplayedCuesAndDerivesActiveStudyMsFromSpans()
    {
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-valid-multi-cue.json"));
        var spans = new PlaybackSpan[] { new(120000, 150000), new(120000, 150000) };

        var result = await context.CreateAsync(spans);

        Assert.Single(result.Segment!.TranscriptCues);
        Assert.Equal(60000, result.Segment.ActiveStudyMs);
    }

    // ============================================================
    // idempotency and concurrency
    // ============================================================

    [Fact]
    public async Task ReplayWithSameClientSegmentIdReturnsTheSameSegment()
    {
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-valid-multi-cue.json"));
        var spans = new PlaybackSpan[] { new(0, 60000) };

        var first = await context.CreateAsync(spans);
        var replay = await context.CreateAsync(spans);

        Assert.Equal(first.Segment!.SegmentId, replay.Segment!.SegmentId);
        Assert.Equal(1, replay.Segment.SequenceNumber);
    }

    [Fact]
    public async Task SameClientSegmentIdWithDifferentPayloadConflicts()
    {
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-valid-multi-cue.json"));

        await context.CreateAsync([new PlaybackSpan(0, 60000)]);
        var conflict = await context.CreateAsync([new PlaybackSpan(0, 90000)]);

        Assert.Null(conflict.Segment);
        Assert.Equal("segmentConflict", conflict.ErrorCode);
        Assert.Equal(409, conflict.StatusCode);
    }

    [Fact]
    public async Task ConcurrentIdenticalRequestsCreateExactlyOneSegment()
    {
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-valid-multi-cue.json"));
        var spans = new PlaybackSpan[] { new(0, 60000) };

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => context.CreateAsync(spans)));

        Assert.All(results, result => Assert.NotNull(result.Segment));
        Assert.Single(results.Select(result => result.Segment!.SegmentId).Distinct());
        Assert.All(results, result => Assert.Equal(1, result.Segment!.SequenceNumber));
    }

    [Fact]
    public async Task SequenceNumberIncreasesPerSession()
    {
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-valid-multi-cue.json"));

        var first = await context.CreateAsync([new PlaybackSpan(0, 60000)], clientSegmentId: "aaaa0001-0000-4000-8000-000000000001");
        var second = await context.CreateAsync([new PlaybackSpan(120000, 180000)], clientSegmentId: "aaaa0001-0000-4000-8000-000000000002");

        Assert.Equal(1, first.Segment!.SequenceNumber);
        Assert.Equal(2, second.Segment!.SequenceNumber);
        Assert.NotEqual(first.Segment.SegmentId, second.Segment.SegmentId);
    }

    // ============================================================
    // transcript and session failures
    // ============================================================

    [Fact]
    public async Task UnavailableTranscriptIsRejectedWithoutCreatingASegment()
    {
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-unavailable.json"));

        var result = await context.CreateAsync([new PlaybackSpan(0, 60000)]);

        Assert.Null(result.Segment);
        Assert.Equal("transcriptUnavailable", result.ErrorCode);
        Assert.Equal(422, result.StatusCode);
        Assert.False(result.Retryable);
    }

    [Fact]
    public async Task InsufficientTranscriptIsRejectedWithItsOwnCode()
    {
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-insufficient.json"));

        var result = await context.CreateAsync([new PlaybackSpan(0, 60000)]);

        Assert.Equal("transcriptInsufficient", result.ErrorCode);
        Assert.Equal(422, result.StatusCode);
    }

    [Fact]
    public async Task SessionWithoutTranscriptSnapshotIsRejected()
    {
        var context = SegmentTestContext.WithoutTranscriptSnapshot();

        var result = await context.CreateAsync([new PlaybackSpan(0, 60000)]);

        Assert.Equal("transcriptUnavailable", result.ErrorCode);
    }

    [Fact]
    public async Task SpansThatMatchNoCueAreRejectedAsInsufficient()
    {
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-valid-multi-cue.json"));

        var result = await context.CreateAsync([new PlaybackSpan(900000, 960000)]);

        Assert.Equal("transcriptInsufficient", result.ErrorCode);
    }

    [Fact]
    public async Task UnknownSessionReturnsNotFound()
    {
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-valid-multi-cue.json"));

        var result = await context.CreateAsync([new PlaybackSpan(0, 60000)], sessionId: "99999999-9999-4999-8999-999999999999");

        Assert.Equal("sessionNotFound", result.ErrorCode);
        Assert.Equal(404, result.StatusCode);
    }

    [Fact]
    public async Task CompletedSessionDoesNotAcceptNewSegments()
    {
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-valid-multi-cue.json"));
        context.CompleteSession();

        var result = await context.CreateAsync([new PlaybackSpan(0, 60000)]);

        Assert.Equal("sessionCompleted", result.ErrorCode);
        Assert.Equal(409, result.StatusCode);
    }

    [Fact]
    public async Task InvalidPayloadsAreRejectedBeforeTranscriptAccess()
    {
        var context = SegmentTestContext.WithTranscript(SegmentFixtures.Transcript("transcript-valid-multi-cue.json"));

        Assert.Equal("invalidPlaybackSpans", (await context.CreateAsync([])).ErrorCode);
        Assert.Equal("invalidPlaybackSpans", (await context.CreateAsync([new PlaybackSpan(60000, 60000)])).ErrorCode);
        Assert.Equal("invalidPlaybackSpans", (await context.CreateAsync([new PlaybackSpan(-1, 60000)])).ErrorCode);
        Assert.Equal("invalidSegmentRequest", (await context.CreateAsync([new PlaybackSpan(0, 60000)], activeStudyMs: -5)).ErrorCode);
        Assert.Equal(0, context.TranscriptReads);
    }
}

// ============================================================
// test context
// ============================================================

internal sealed class SegmentTestContext
{
    private const string DefaultClientSegmentId = "44444444-4444-4444-8444-444444444444";

    private readonly StudySessionService _sessions = new();
    private readonly FakeTranscriptCaptureReader _reader;
    private readonly CreateSegmentHandler _handler;
    private readonly string _sessionId;

    private SegmentTestContext(TranscriptSnapshotForSession? transcript, bool attachSnapshot)
    {
        _reader = new FakeTranscriptCaptureReader(transcript);
        _handler = new CreateSegmentHandler(_sessions, new InMemorySegmentStore(), _reader);
        var start = _sessions.Start(new StartStudySessionCommand(
            "11111111-1111-4111-8111-111111111111",
            "active",
            "dQw4w9WgXcQ",
            attachSnapshot ? "22222222-2222-4222-8222-222222222222" : null,
            10,
            "multipleChoice",
            "medium"));
        _sessionId = start.Session!.SessionId;
    }

    public int TranscriptReads => _reader.Reads;

    public static SegmentTestContext WithTranscript(TranscriptSnapshotForSession transcript) => new(transcript, attachSnapshot: true);

    public static SegmentTestContext WithoutTranscriptSnapshot() => new(null, attachSnapshot: false);

    public void CompleteSession() =>
        _sessions.Complete(new CompleteStudySessionCommand(_sessionId, "33333333-3333-4333-8333-333333333333", "videoEnded", 600000));

    public Task<CreateSegmentResult> CreateAsync(
        IReadOnlyList<PlaybackSpan> spans,
        long? activeStudyMs = null,
        string? clientSegmentId = null,
        string? sessionId = null)
    {
        var segmentId = clientSegmentId ?? DefaultClientSegmentId;
        var command = new CreateSegmentCommand(
            sessionId ?? _sessionId,
            segmentId,
            $"segment:{sessionId ?? _sessionId}:{segmentId}",
            activeStudyMs,
            spans);
        return _handler.HandleAsync(command, CancellationToken.None);
    }
}

internal sealed class FakeTranscriptCaptureReader : ITranscriptCaptureReader
{
    private readonly TranscriptCaptureForSession? _capture;

    public FakeTranscriptCaptureReader(TranscriptSnapshotForSession? snapshot) => _capture = snapshot is null ? null : new TranscriptCaptureForSession(
        "22222222-2222-4222-8222-222222222222", snapshot.YoutubeVideoId, snapshot.Language, snapshot.Status.ToString().ToLowerInvariant(), 1, snapshot.Cues);

    public int Reads { get; private set; }

    public Task<TranscriptCaptureForSession?> GetForSessionAsync(string transcriptCaptureId, CancellationToken cancellationToken)
    {
        Reads += 1;
        return Task.FromResult(_capture);
    }
}

// ============================================================
// fixture loading
// ============================================================

internal static class SegmentFixtures
{
    private static readonly string Root = FindFixtureRoot();

    public static JsonElement Load(string fileName) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(Root, fileName))).RootElement.Clone();

    public static TranscriptSnapshotForSession Transcript(string fileName)
    {
        var fixture = Load(fileName);
        var cues = fixture.GetProperty("cues").EnumerateArray()
            .Select(cue => new TranscriptCueForSession(
                cue.GetProperty("transcriptCueId").GetString()!,
                cue.GetProperty("startMs").GetInt64(),
                cue.GetProperty("endMs").GetInt64(),
                cue.GetProperty("text").GetString()!))
            .ToArray();

        return new TranscriptSnapshotForSession(
            fixture.GetProperty("transcriptSnapshotId").GetString()!,
            fixture.GetProperty("youtubeVideoId").GetString()!,
            fixture.GetProperty("language").GetString()!,
            Enum.Parse<TranscriptSnapshotStatus>(fixture.GetProperty("status").GetString()!, ignoreCase: true),
            fixture.GetProperty("version").GetString()!,
            null,
            cues);
    }

    public static PlaybackSpan[] Spans(JsonElement fixture) =>
        fixture.GetProperty("playbackSpans").EnumerateArray()
            .Select(span => new PlaybackSpan(span.GetProperty("startMs").GetInt64(), span.GetProperty("endMs").GetInt64()))
            .ToArray();

    public static long? ActiveStudyMs(JsonElement fixture) =>
        fixture.TryGetProperty("activeStudyMs", out var value) ? value.GetInt64() : null;

    public static IEnumerable<string> ExpectedCueIds(JsonElement fixture) =>
        fixture.GetProperty("expectedCueIds").EnumerateArray().Select(id => id.GetString()!);

    private static string FindFixtureRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "contracts", "examples", "session-quiz");
            if (Directory.Exists(candidate)) return candidate;
            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("contracts/examples/session-quiz was not found from the test output directory.");
    }
}
