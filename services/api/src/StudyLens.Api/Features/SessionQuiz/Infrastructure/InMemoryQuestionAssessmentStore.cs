using System.Collections.Concurrent;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Application.Abstractions;

namespace StudyLens.Api.Features.SessionQuiz.Infrastructure;

/** Test-only fallback. Production registration uses SQLite. */
public sealed class InMemoryQuestionAssessmentStore : IQuestionAssessmentStore
{
    private readonly ConcurrentDictionary<string, QuizAssessmentRecord> _byIdempotencyKey = new();

    public Task<QuizAssessmentRecord?> FindByIdempotencyKeyAsync(string idempotencyKey, CancellationToken cancellationToken) =>
        Task.FromResult(_byIdempotencyKey.TryGetValue(idempotencyKey, out var value) ? value : null);

    public Task<QuestionForAssessment?> FindAsync(string quizId, string questionId, CancellationToken cancellationToken)
    {
        var question = _byIdempotencyKey.Values
            .Where(record => record.Quiz.QuizId == quizId)
            .SelectMany(record => record.Questions)
            .FirstOrDefault(question => question.QuestionId == questionId);
        return Task.FromResult(question);
    }

    public Task<QuizPublicModel?> FindQuizAsync(string quizId, CancellationToken cancellationToken)
    {
        var quiz = _byIdempotencyKey.Values
            .Select(record => record.Quiz)
            .FirstOrDefault(item => item.QuizId == quizId);
        return Task.FromResult(quiz);
    }

    public Task SaveAsync(QuizAssessmentRecord record, CancellationToken cancellationToken)
    {
        _byIdempotencyKey.TryAdd(record.IdempotencyKey, record);
        return Task.CompletedTask;
    }
}
