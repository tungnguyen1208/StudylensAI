using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.AssessmentHistory.Infrastructure;
using StudyLens.Api.Features.SessionQuiz.Application.Abstractions;

namespace StudyLens.Api.Features.AssessmentHistory.Application;

public sealed class AssessmentHistoryService(
    AssessmentHistoryDbContext db,
    IQuestionAssessmentReader questions,
    IShortAnswerGradingGateway shortAnswers)
{
    public async Task<AssessmentResult> SubmitAsync(SubmitAnswerCommand command, CancellationToken cancellationToken)
    {
        if (command.ContractVersion != "0.2.0" || string.IsNullOrWhiteSpace(command.ClientAttemptId) || string.IsNullOrWhiteSpace(command.QuestionId))
            return AssessmentResult.Invalid("invalidAnswerRequest", "A valid answer request is required.");

        var existing = await db.AnswerAttempts.SingleOrDefaultAsync(item => item.ClientAttemptId == command.ClientAttemptId, cancellationToken);
        if (existing is not null)
            return SameSubmission(existing, command) ? AssessmentResult.Success(ToGrade(existing)) : AssessmentResult.Conflict();

        var question = await questions.FindAsync(command.QuizId, command.QuestionId, cancellationToken);
        if (question is null) return AssessmentResult.NotFound("questionNotFound", "The quiz question was not found.");
        if (!IsValidAnswer(question.Type, command)) return AssessmentResult.Invalid("invalidAnswer", "The submitted answer does not match the question type.");

        var grade = question.Type == "multipleChoice"
            ? GradeMultipleChoice(question, command.SelectedOptionId!)
            : await GradeShortAnswerAsync(question, command.AnswerText!, cancellationToken);
        if (grade is null) return AssessmentResult.Unavailable("gradingUnavailable", "Answer grading is temporarily unavailable.");

        var attempt = new AnswerAttemptEntity
        {
            AnswerAttemptId = Guid.NewGuid().ToString(),
            ClientAttemptId = command.ClientAttemptId,
            QuizId = command.QuizId,
            SessionId = question.SessionId,
            QuestionId = question.QuestionId,
            YoutubeVideoId = question.YoutubeVideoId,
            QuestionPrompt = question.Prompt,
            QuestionType = question.Type,
            SubmittedAnswer = command.SelectedOptionId ?? command.AnswerText!,
            Outcome = grade.Outcome,
            Score = grade.Score,
            ReferenceAnswer = grade.ReferenceAnswer,
            Explanation = grade.Explanation,
            SourceStartMs = question.SourceStartMs,
            SourceEndMs = question.SourceEndMs,
            GradedAtUtc = DateTimeOffset.UtcNow,
        };
        db.AnswerAttempts.Add(attempt);
        await db.SaveChangesAsync(cancellationToken);
        return AssessmentResult.Success(ToGrade(attempt));
    }

    public async Task<IReadOnlyList<HistoryItem>> ReadHistoryAsync(string? youtubeVideoId, CancellationToken cancellationToken)
    {
        var query = db.AnswerAttempts.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(youtubeVideoId)) query = query.Where(item => item.YoutubeVideoId == youtubeVideoId);
        var items = await query.Take(100).Select(item => new HistoryItem(
            item.AnswerAttemptId, item.YoutubeVideoId, item.SessionId, item.QuestionId, item.QuestionPrompt,
            item.QuestionType, item.SubmittedAnswer, item.Outcome, item.Score, item.Explanation,
            item.SourceStartMs, item.GradedAtUtc)).ToArrayAsync(cancellationToken);
        return items.OrderByDescending(item => item.SubmittedAtUtc).ToArray();
    }

    private static bool SameSubmission(AnswerAttemptEntity existing, SubmitAnswerCommand command) =>
        existing.QuizId == command.QuizId && existing.QuestionId == command.QuestionId &&
        existing.SubmittedAnswer == (command.SelectedOptionId ?? command.AnswerText);

    private static bool IsValidAnswer(string questionType, SubmitAnswerCommand command) => questionType switch
    {
        "multipleChoice" => !string.IsNullOrWhiteSpace(command.SelectedOptionId) && string.IsNullOrWhiteSpace(command.AnswerText),
        "shortAnswer" => string.IsNullOrWhiteSpace(command.SelectedOptionId) && !string.IsNullOrWhiteSpace(command.AnswerText),
        _ => false,
    };

    private static GradeData GradeMultipleChoice(QuestionForAssessment question, string selectedOptionId)
    {
        var correct = selectedOptionId == question.CorrectOptionId;
        var reference = question.Options?.FirstOrDefault(item => item.OptionId == question.CorrectOptionId)?.Text ?? "Đáp án đúng đã được ghi nhận.";
        return correct
            ? new GradeData("correct", 1, reference, "Câu trả lời khớp với đáp án của bài kiểm tra.")
            : new GradeData("incorrect", 0, reference, "Câu trả lời chưa khớp với đáp án của bài kiểm tra.");
    }

    private async Task<GradeData?> GradeShortAnswerAsync(QuestionForAssessment question, string answerText, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(question.ReferenceAnswer)) return null;
        var response = await shortAnswers.GradeAsync(new(question.QuestionId, question.Prompt, question.ReferenceAnswer, answerText), cancellationToken);
        return response is null ? null : new GradeData(response.Outcome, response.Score, response.ReferenceAnswer, response.Explanation);
    }

    private static GradeView ToGrade(AnswerAttemptEntity entity) => new(
        entity.AnswerAttemptId, entity.QuestionId, entity.Outcome, entity.Score, entity.ReferenceAnswer,
        entity.Explanation, new SourceRef(entity.YoutubeVideoId, entity.SourceStartMs, entity.SourceEndMs), entity.GradedAtUtc);
}

public sealed record SubmitAnswerCommand(string ContractVersion, string ClientAttemptId, string QuizId, string QuestionId, string? SelectedOptionId, string? AnswerText);
public sealed record GradeData(string Outcome, double Score, string ReferenceAnswer, string Explanation);
public sealed record GradeView(string AnswerAttemptId, string QuestionId, string Outcome, double Score, string ReferenceAnswer, string Explanation, SourceRef Source, DateTimeOffset GradedAtUtc);
public sealed record SourceRef(string YoutubeVideoId, long StartMs, long EndMs);
public sealed record HistoryItem(string AnswerAttemptId, string YoutubeVideoId, string SessionId, string QuestionId, string QuestionPrompt, string QuestionType, string SubmittedAnswer, string Outcome, double Score, string Explanation, long TimestampMs, DateTimeOffset SubmittedAtUtc);
public sealed record AssessmentResult(GradeView? Grade, string? ErrorCode, string? ErrorMessage, int StatusCode)
{
    public static AssessmentResult Success(GradeView grade) => new(grade, null, null, StatusCodes.Status200OK);
    public static AssessmentResult Invalid(string code, string message) => new(null, code, message, StatusCodes.Status400BadRequest);
    public static AssessmentResult NotFound(string code, string message) => new(null, code, message, StatusCodes.Status404NotFound);
    public static AssessmentResult Conflict() => new(null, "idempotencyConflict", "The client attempt ID was reused with a different answer.", StatusCodes.Status409Conflict);
    public static AssessmentResult Unavailable(string code, string message) => new(null, code, message, StatusCodes.Status503ServiceUnavailable);
}
