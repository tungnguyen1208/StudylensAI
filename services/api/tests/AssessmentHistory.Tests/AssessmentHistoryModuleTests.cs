using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using System.Net;
using StudyLens.Api.Features.AssessmentHistory;
using StudyLens.Api.Features.AssessmentHistory.Application;
using StudyLens.Api.Features.AssessmentHistory.Infrastructure;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Application.Abstractions;
using StudyLens.Api.Infrastructure.Persistence;
using Xunit;

namespace AssessmentHistory.Tests;

public class AssessmentHistoryModuleTests
{
    [Fact]
    public void AddAssessmentHistoryModule_ShouldRegisterSuccessfully()
    {
        // Arrange
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();

        // Act
        services.AddAssessmentHistoryModule(configuration);
        var provider = services.BuildServiceProvider();

        // Assert
        Assert.NotNull(provider);
    }

    [Fact]
    public async Task SubmitAnswer_PersistsAndReplaysDeterministicMultipleChoiceGrade()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>()
            .UseSqlite($"Data Source={Path.Combine(Path.GetTempPath(), $"studylens-assessment-{Guid.NewGuid()}.db")}")
            .Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.EnsureCreatedAsync();
        var service = new AssessmentHistoryService(
            new AssessmentHistoryDbContext(db), new FakeQuestionReader(), new FakeShortAnswerGateway());
        var command = new SubmitAnswerCommand("0.4.0", "11111111-1111-4111-8111-111111111111", "quiz-1", "question-1", "option-a", null);

        var first = await service.SubmitAsync(command, CancellationToken.None);
        var replay = await service.SubmitAsync(command, CancellationToken.None);
        var history = await service.ReadHistoryAsync("dQw4w9WgXcQ", CancellationToken.None);

        Assert.Equal("correct", first.Grade!.Outcome);
        Assert.Equal(first.Grade.AnswerAttemptId, replay.Grade!.AnswerAttemptId);
        Assert.Single(history);
        Assert.Equal("option-a", history[0].SubmittedAnswer);
    }

    [Fact]
    public async Task SubmitAnswer_RejectsConflictingIdempotencyKeyAndPersistsHistoryAcrossContexts()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"studylens-history-{Guid.NewGuid()}.db");
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite($"Data Source={databasePath}").Options;
        const string clientAttemptId = "22222222-2222-4222-8222-222222222222";

        await using (var firstContext = new StudyLensDbContext(options))
        {
            await firstContext.Database.EnsureCreatedAsync();
            var service = new AssessmentHistoryService(
                new AssessmentHistoryDbContext(firstContext), new FakeQuestionReader(), new FakeShortAnswerGateway());
            var created = await service.SubmitAsync(new SubmitAnswerCommand(
                "0.4.0", clientAttemptId, "quiz-1", "question-1", "option-a", null), CancellationToken.None);
            var conflict = await service.SubmitAsync(new SubmitAnswerCommand(
                "0.4.0", clientAttemptId, "quiz-1", "question-1", "option-b", null), CancellationToken.None);

            Assert.Equal("correct", created.Grade!.Outcome);
            Assert.Equal(409, conflict.StatusCode);
            Assert.Equal("idempotencyConflict", conflict.ErrorCode);
        }

        await using (var restartedContext = new StudyLensDbContext(options))
        {
            var service = new AssessmentHistoryService(
                new AssessmentHistoryDbContext(restartedContext), new FakeQuestionReader(), new FakeShortAnswerGateway());
            var history = await service.ReadHistoryAsync("dQw4w9WgXcQ", CancellationToken.None);

            Assert.Single(history);
            Assert.Equal(clientAttemptId, (await restartedContext.Set<AnswerAttemptEntity>().SingleAsync()).ClientAttemptId);
        }
    }

    [Fact]
    public async Task SubmitAnswer_UsesShortAnswerGradingGatewayWithoutExposingPrivateQuestionData()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        var service = new AssessmentHistoryService(
            new AssessmentHistoryDbContext(db), new FakeQuestionReader(), new FakeShortAnswerGateway());

        var result = await service.SubmitAsync(new SubmitAnswerCommand(
            "0.4.0", "33333333-3333-4333-8333-333333333333", "quiz-1", "question-short", null, "An answer"), CancellationToken.None);

        Assert.Equal("correct", result.Grade!.Outcome);
        Assert.Equal("Reference answer", result.Grade.ReferenceAnswer);
    }

    [Fact]
    public async Task SubmitAnswer_RejectsAnOptionThatDoesNotBelongToTheQuestion()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>()
            .UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        var service = new AssessmentHistoryService(
            new AssessmentHistoryDbContext(db), new FakeQuestionReader(), new FakeShortAnswerGateway());

        var result = await service.SubmitAsync(new SubmitAnswerCommand(
            "0.4.0", "55555555-5555-4555-8555-555555555555", "quiz-1", "question-1", "option-missing", null), CancellationToken.None);

        Assert.Null(result.Grade);
        Assert.Equal(400, result.StatusCode);
        Assert.Equal("invalidOption", result.ErrorCode);
        Assert.Empty(await db.Set<AnswerAttemptEntity>().ToArrayAsync());
    }

    [Fact]
    public async Task SubmitAnswer_MapsInvalidFakeAiOutputToRetryableGradingFailure()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>()
            .UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        var service = new AssessmentHistoryService(
            new AssessmentHistoryDbContext(db), new FakeQuestionReader(), new InvalidShortAnswerGateway());

        var result = await service.SubmitAsync(new SubmitAnswerCommand(
            "0.4.0", "66666666-6666-4666-8666-666666666666", "quiz-1", "question-short", null, "An answer"), CancellationToken.None);

        Assert.Null(result.Grade);
        Assert.Equal(503, result.StatusCode);
        Assert.Equal("gradingUnavailable", result.ErrorCode);
    }

    [Fact]
    public async Task ShortAnswerGradingClient_TreatsInvalidFakeAiResponseAsRetryableGatewayFailure()
    {
        using var httpClient = new HttpClient(new StaticResponseHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("not-json"),
        }));
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AiService:BaseUrl"] = "https://fake-ai.test",
        }).Build();
        var gateway = new ShortAnswerGradingClient(httpClient, configuration);

        var result = await gateway.GradeAsync(new ShortAnswerGradeRequest(
            "0.4.0", "question-1", "Prompt", "Reference answer", "Answer"), CancellationToken.None);

        Assert.Null(result);
    }

    [Fact]
    public async Task ShortAnswerGradingClient_RejectsAnOutOfContractFakeAiGrade()
    {
        using var httpClient = new HttpClient(new StaticResponseHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"outcome\":\"unknown\",\"score\":2,\"referenceAnswer\":\"Answer\",\"explanation\":\"Explanation\"}"),
        }));
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AiService:BaseUrl"] = "https://fake-ai.test",
        }).Build();
        var gateway = new ShortAnswerGradingClient(httpClient, configuration);

        var result = await gateway.GradeAsync(new ShortAnswerGradeRequest(
            "0.4.0", "question-1", "Prompt", "Reference answer", "Answer"), CancellationToken.None);

        Assert.Null(result);
    }

    [Fact]
    public async Task ShortAnswerGradingClient_SendsTheAiContractVersion()
    {
        var handler = new StaticResponseHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"outcome\":\"correct\",\"score\":1,\"referenceAnswer\":\"Answer\",\"explanation\":\"OK\"}"),
        });
        using var httpClient = new HttpClient(handler);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AiService:BaseUrl"] = "https://fake-ai.test",
        }).Build();
        var gateway = new ShortAnswerGradingClient(httpClient, configuration);

        var result = await gateway.GradeAsync(new ShortAnswerGradeRequest(
            "0.4.0", "question-1", "Prompt", "Reference answer", "Answer"), CancellationToken.None);

        Assert.NotNull(result);
        Assert.Contains("\"contractVersion\":\"0.4.0\"", handler.RequestBody ?? string.Empty);
    }

    private sealed class FakeQuestionReader : IQuestionAssessmentReader
    {
        public Task<QuestionForAssessment?> FindAsync(string quizId, string questionId, CancellationToken cancellationToken) =>
            Task.FromResult<QuestionForAssessment?>(quizId == "quiz-1" && questionId == "question-1"
                ? new QuestionForAssessment("quiz-1", "session-1", "question-1", "multipleChoice", "Question", "option-a",
                    [new QuestionOptionPublicModel("option-a", "Correct answer"), new QuestionOptionPublicModel("option-b", "Wrong answer")],
                    null, "dQw4w9WgXcQ", 0, 1000)
                : quizId == "quiz-1" && questionId == "question-short"
                    ? new QuestionForAssessment("quiz-1", "session-1", "question-short", "shortAnswer", "Question", null,
                        null, "Reference answer", "dQw4w9WgXcQ", 1000, 2000)
                : null);
    }

    private sealed class FakeShortAnswerGateway : IShortAnswerGradingGateway
    {
        public Task<ShortAnswerGradeResponse?> GradeAsync(ShortAnswerGradeRequest request, CancellationToken cancellationToken) =>
            Task.FromResult<ShortAnswerGradeResponse?>(new("correct", 1, request.ReferenceAnswer, "OK"));
    }

    private sealed class InvalidShortAnswerGateway : IShortAnswerGradingGateway
    {
        public Task<ShortAnswerGradeResponse?> GradeAsync(ShortAnswerGradeRequest request, CancellationToken cancellationToken) =>
            Task.FromResult<ShortAnswerGradeResponse?>(new("unexpected", 2, string.Empty, string.Empty));
    }

    private sealed class StaticResponseHandler(HttpResponseMessage response) : HttpMessageHandler
    {
        public string? RequestBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            return response;
        }
    }
}
