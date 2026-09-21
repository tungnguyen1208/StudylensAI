using StudyLens.Api.Features.SessionQuiz.Application;

namespace StudyLens.Api.Features.SessionQuiz.Application.Abstractions;

/** Internal Backend-only port. It never crosses the Extension boundary. */
public interface IQuestionAssessmentReader
{
    Task<QuestionForAssessment?> FindAsync(string quizId, string questionId, CancellationToken cancellationToken);
}

public interface IQuestionAssessmentStore : IQuestionAssessmentReader
{
    Task<QuizAssessmentRecord?> FindByIdempotencyKeyAsync(string idempotencyKey, CancellationToken cancellationToken);
    Task<QuizPublicModel?> FindQuizAsync(string quizId, CancellationToken cancellationToken);
    Task SaveAsync(QuizAssessmentRecord record, CancellationToken cancellationToken);
}

public sealed record QuestionForAssessment(
    string QuizId,
    string SessionId,
    string QuestionId,
    string Type,
    string Prompt,
    string? CorrectOptionId,
    IReadOnlyList<QuestionOptionPublicModel>? Options,
    string? ReferenceAnswer,
    string YoutubeVideoId,
    long SourceStartMs,
    long SourceEndMs);

public sealed record QuizAssessmentRecord(
    string IdempotencyKey,
    QuizPublicModel Quiz,
    IReadOnlyList<QuestionForAssessment> Questions);
