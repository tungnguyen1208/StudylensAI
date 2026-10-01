using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.AssessmentHistory.Infrastructure;
using StudyLens.Api.Features.SessionQuiz.Application.Abstractions;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;

namespace StudyLens.Api.Features.AssessmentHistory.Application;

public sealed class AssessmentHistoryService(
    AssessmentHistoryDbContext db,
    IQuestionAssessmentReader questions,
    IShortAnswerGradingGateway shortAnswers,
    StudyLensDbContext? rootDb = null)
{
    public async Task<QuizAttemptResult> SubmitAttemptAsync(SubmitQuizAttemptCommand command, CancellationToken cancellationToken)
    {
        if (command.ContractVersion != "0.5.0" || !Guid.TryParse(command.ClientAttemptId, out _) || command.Answers.Count == 0 ||
            command.Answers.Select(item => item.QuestionId).Distinct(StringComparer.Ordinal).Count() != command.Answers.Count)
            return QuizAttemptResult.Invalid("invalidAttemptRequest", "A complete 0.5.0 quiz attempt is required.");

        var existing = await db.QuizAttempts.AsNoTracking().Include(item => item.Answers)
            .SingleOrDefaultAsync(item => item.ClientAttemptId == command.ClientAttemptId, cancellationToken);
        if (existing is not null)
            return SameAttempt(existing, command) ? QuizAttemptResult.Success(ToAttemptView(existing)) : QuizAttemptResult.Conflict();

        var database = rootDb ?? db.RootDb;
        var quiz = await database.Set<QuizAssessmentEntity>().AsNoTracking().Include(item => item.Questions).ThenInclude(item => item.Options)
            .SingleOrDefaultAsync(item => item.QuizId == command.QuizId, cancellationToken);
        if (quiz is null) return QuizAttemptResult.NotFound("quizNotFound", "The quiz was not found.");
        if (quiz.Status != "ready" || quiz.Questions.Any(question => question.YoutubeVideoId != quiz.YoutubeVideoId))
            return QuizAttemptResult.Invalid("quizNotReady", "The quiz is not ready for this video.");
        var session = await database.Set<StudySessionEntity>().SingleOrDefaultAsync(item => item.SessionId == quiz.SessionId, cancellationToken);
        if (session is null || session.Status is not ("active" or "closed" or "completed") || session.QuizStatus != "ready" ||
            session.QuizId != quiz.QuizId || session.YoutubeVideoId != quiz.YoutubeVideoId)
            return QuizAttemptResult.Invalid("sessionNotReady", "The video session is not ready for a quiz attempt.");
        if (quiz.Questions.Count != command.Answers.Count || quiz.Questions.Any(question => command.Answers.All(answer => answer.QuestionId != question.QuestionId)))
            return QuizAttemptResult.Invalid("incompleteAttempt", "Every quiz question must be answered exactly once.");

        var attemptId = Guid.NewGuid().ToString();
        var graded = new List<AttemptAnswerEntity>(quiz.Questions.Count);
        foreach (var question in quiz.Questions)
        {
            var submitted = command.Answers.Single(item => item.QuestionId == question.QuestionId);
            if (!ValidAnswer(question.Type, submitted))
                return QuizAttemptResult.Invalid("invalidAnswer", "An answer does not match its question type.");
            GradeData? grade;
            if (question.Type == "multipleChoice")
            {
                var selected = question.Options.SingleOrDefault(item => item.OptionId == submitted.SelectedOptionId);
                if (selected is null) return QuizAttemptResult.Invalid("invalidOption", "A selected option does not belong to its quiz question.");
                var correct = submitted.SelectedOptionId == question.CorrectOptionId;
                var reference = question.Options.SingleOrDefault(item => item.OptionId == question.CorrectOptionId)?.Text ?? string.Empty;
                grade = new GradeData(correct ? "correct" : "incorrect", correct ? 1 : 0, reference,
                    string.IsNullOrWhiteSpace(question.Explanation) ? (correct ? "The selected answer is correct." : "Review the referenced video passage.") : question.Explanation);
            }
            else
            {
                if (string.IsNullOrWhiteSpace(question.ReferenceAnswer))
                    return QuizAttemptResult.Invalid("missingReferenceAnswer", "The short-answer question cannot be graded.");
                var response = await shortAnswers.GradeAsync(new("0.5.0", question.QuestionId, question.Prompt, question.ReferenceAnswer, submitted.AnswerText!), cancellationToken);
                if (response is null || !IsValidShortAnswerGrade(response))
                    return QuizAttemptResult.Unavailable("gradingUnavailable", "Short-answer grading is temporarily unavailable.");
                grade = new GradeData(response.Outcome, response.Score, response.ReferenceAnswer, response.Explanation);
            }

            graded.Add(new AttemptAnswerEntity
            {
                AttemptAnswerId = Guid.NewGuid().ToString(), QuizAttemptId = attemptId, QuestionId = question.QuestionId,
                YoutubeVideoId = question.YoutubeVideoId, QuestionPrompt = question.Prompt, QuestionType = question.Type,
                SubmittedAnswer = submitted.SelectedOptionId ?? submitted.AnswerText!, Outcome = grade.Outcome, Score = grade.Score,
                ReferenceAnswer = grade.ReferenceAnswer, Explanation = grade.Explanation,
                SourceStartMs = question.SourceStartMs, SourceEndMs = question.SourceEndMs,
            });
        }

        var attempt = new QuizAttemptEntity
        {
            QuizAttemptId = attemptId, ClientAttemptId = command.ClientAttemptId, QuizId = command.QuizId,
            SessionId = quiz.SessionId, Score = graded.Average(item => item.Score), SubmittedAtUtc = DateTimeOffset.UtcNow, Answers = graded,
        };
        db.QuizAttempts.Add(attempt);
        if (session.Status != "completed")
        {
            session.Status = "completed";
            session.CompletedAtUtc = attempt.SubmittedAtUtc;
            session.CompletionReason = "quizSubmitted";
        }
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            database.ChangeTracker.Clear();
            existing = await db.QuizAttempts.AsNoTracking().Include(item => item.Answers)
                .SingleOrDefaultAsync(item => item.ClientAttemptId == command.ClientAttemptId, cancellationToken);
            if (existing is not null)
                return SameAttempt(existing, command) ? QuizAttemptResult.Success(ToAttemptView(existing)) : QuizAttemptResult.Conflict();
            throw;
        }
        return QuizAttemptResult.Success(ToAttemptView(attempt));
    }

    public async Task<AssessmentResult> SubmitAsync(SubmitAnswerCommand command, CancellationToken cancellationToken)
    {
        if (command.ContractVersion != "0.5.0" || string.IsNullOrWhiteSpace(command.ClientAttemptId) || string.IsNullOrWhiteSpace(command.QuestionId))
            return AssessmentResult.Invalid("invalidAnswerRequest", "A valid answer request is required.");

        var existing = await db.AnswerAttempts.SingleOrDefaultAsync(item => item.ClientAttemptId == command.ClientAttemptId, cancellationToken);
        if (existing is not null)
            return SameSubmission(existing, command) ? AssessmentResult.Success(ToGrade(existing)) : AssessmentResult.Conflict();

        var question = await questions.FindAsync(command.QuizId, command.QuestionId, cancellationToken);
        if (question is null) return AssessmentResult.NotFound("questionNotFound", "The quiz question was not found.");
        if (!IsValidAnswer(question.Type, command)) return AssessmentResult.Invalid("invalidAnswer", "The submitted answer does not match the question type.");
        if (question.Type == "multipleChoice" && !ContainsOption(question, command.SelectedOptionId!))
            return AssessmentResult.Invalid("invalidOption", "The selected option does not belong to the quiz question.");

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
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // A concurrent request can win the unique clientAttemptId race. Replay it safely.
            db.Detach(attempt);
            existing = await db.AnswerAttempts.SingleOrDefaultAsync(item => item.ClientAttemptId == command.ClientAttemptId, cancellationToken);
            if (existing is not null)
                return SameSubmission(existing, command) ? AssessmentResult.Success(ToGrade(existing)) : AssessmentResult.Conflict();
            throw;
        }
        return AssessmentResult.Success(ToGrade(attempt));
    }

    public async Task<IReadOnlyList<HistoryItem>> ReadHistoryAsync(string? youtubeVideoId, CancellationToken cancellationToken)
    {
        var database = rootDb ?? db.RootDb;
        var query = db.AnswerAttempts.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(youtubeVideoId)) query = query.Where(item => item.YoutubeVideoId == youtubeVideoId);
        var legacySource = database.Database.IsSqlite() ? query : query.OrderByDescending(item => item.GradedAtUtc).Take(100);
        var legacyItems = (await legacySource.Select(item => new HistoryItem(
            item.AnswerAttemptId, item.YoutubeVideoId, item.SessionId, item.QuestionId, item.QuestionPrompt,
            item.QuestionType, item.SubmittedAnswer, item.Outcome, item.Score, item.Explanation,
            item.SourceStartMs, item.GradedAtUtc, null, null)).ToArrayAsync(cancellationToken))
            .OrderByDescending(item => item.SubmittedAtUtc).Take(100).ToArray();
        var currentQuery = db.AttemptAnswers.AsNoTracking().Include(item => item.QuizAttempt).AsQueryable();
        if (!string.IsNullOrWhiteSpace(youtubeVideoId)) currentQuery = currentQuery.Where(item => item.YoutubeVideoId == youtubeVideoId);
        var currentSource = database.Database.IsSqlite() ? currentQuery : currentQuery.OrderByDescending(item => item.QuizAttempt!.SubmittedAtUtc).Take(100);
        var currentItems = (await currentSource.Select(item => new HistoryItem(
            item.AttemptAnswerId, item.YoutubeVideoId, item.QuizAttempt!.SessionId, item.QuestionId, item.QuestionPrompt,
            item.QuestionType, item.SubmittedAnswer, item.Outcome, item.Score, item.Explanation,
            item.SourceStartMs, item.QuizAttempt.SubmittedAtUtc, item.QuizAttemptId, item.QuizAttempt.Score)).ToArrayAsync(cancellationToken))
            .OrderByDescending(item => item.SubmittedAtUtc).Take(100).ToArray();
        var items = legacyItems.Concat(currentItems).OrderByDescending(item => item.SubmittedAtUtc).Take(100).ToArray();
        if (items.Length == 0) return items;

        var sessionIds = items.Select(item => item.SessionId).Distinct().ToArray();
        var videoIds = items.Select(item => item.YoutubeVideoId).Distinct().ToArray();
        var sessionTitles = await database.Set<StudySessionEntity>().AsNoTracking()
            .Where(item => sessionIds.Contains(item.SessionId))
            .Select(item => new { item.SessionId, item.VideoTitle, item.YoutubeVideoId })
            .ToDictionaryAsync(item => item.SessionId, cancellationToken);
        var videoTitles = await database.Set<StudyVideoEntity>().AsNoTracking()
            .Where(item => videoIds.Contains(item.YoutubeVideoId))
            .ToDictionaryAsync(item => item.YoutubeVideoId, item => item.Title, cancellationToken);
        return items.Select(item =>
        {
            sessionTitles.TryGetValue(item.SessionId, out var session);
            videoTitles.TryGetValue(item.YoutubeVideoId, out var videoTitle);
            return item with
            {
                VideoTitle = session?.YoutubeVideoId == item.YoutubeVideoId ? session.VideoTitle : videoTitle,
                VideoUrl = ValidYoutubeVideoId(item.YoutubeVideoId)
                    ? $"https://www.youtube.com/watch?v={item.YoutubeVideoId}" : null,
            };
        }).ToArray();
    }

    private static bool ValidYoutubeVideoId(string value) => value.Length == 11 &&
        value.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-');

    private static bool SameSubmission(AnswerAttemptEntity existing, SubmitAnswerCommand command) =>
        existing.QuizId == command.QuizId && existing.QuestionId == command.QuestionId &&
        existing.SubmittedAnswer == (command.SelectedOptionId ?? command.AnswerText);

    private static bool IsValidAnswer(string questionType, SubmitAnswerCommand command) => questionType switch
    {
        "multipleChoice" => !string.IsNullOrWhiteSpace(command.SelectedOptionId) && string.IsNullOrWhiteSpace(command.AnswerText),
        "shortAnswer" => string.IsNullOrWhiteSpace(command.SelectedOptionId) && !string.IsNullOrWhiteSpace(command.AnswerText),
        _ => false,
    };

    private static bool ContainsOption(QuestionForAssessment question, string selectedOptionId) =>
        question.Options?.Any(option => option.OptionId == selectedOptionId) == true;

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
        var response = await shortAnswers.GradeAsync(new("0.5.0", question.QuestionId, question.Prompt, question.ReferenceAnswer, answerText), cancellationToken);
        return response is null || !IsValidShortAnswerGrade(response)
            ? null
            : new GradeData(response.Outcome, response.Score, response.ReferenceAnswer, response.Explanation);
    }

    private static bool IsValidShortAnswerGrade(ShortAnswerGradeResponse response) =>
        (response.Outcome is "correct" or "incorrect" or "partiallyCorrect") &&
        double.IsFinite(response.Score) && response.Score is >= 0 and <= 1 &&
        !string.IsNullOrWhiteSpace(response.ReferenceAnswer) &&
        !string.IsNullOrWhiteSpace(response.Explanation);

    private static GradeView ToGrade(AnswerAttemptEntity entity) => new(
        entity.AnswerAttemptId, entity.QuestionId, entity.Outcome, entity.Score, entity.ReferenceAnswer,
        entity.Explanation, new SourceRef(entity.YoutubeVideoId, entity.SourceStartMs, entity.SourceEndMs), entity.GradedAtUtc);

    private static bool ValidAnswer(string questionType, SubmitAttemptAnswer command) => questionType switch
    {
        "multipleChoice" => !string.IsNullOrWhiteSpace(command.SelectedOptionId) && string.IsNullOrWhiteSpace(command.AnswerText),
        "shortAnswer" => string.IsNullOrWhiteSpace(command.SelectedOptionId) && !string.IsNullOrWhiteSpace(command.AnswerText),
        _ => false,
    };

    private static bool SameAttempt(QuizAttemptEntity existing, SubmitQuizAttemptCommand command) => existing.QuizId == command.QuizId &&
        existing.Answers.Count == command.Answers.Count && existing.Answers.All(answer => command.Answers.Any(submitted =>
            submitted.QuestionId == answer.QuestionId && (submitted.SelectedOptionId ?? submitted.AnswerText) == answer.SubmittedAnswer));

    private static QuizAttemptView ToAttemptView(QuizAttemptEntity entity) => new(entity.QuizAttemptId, entity.QuizId, entity.Score,
        entity.Answers.Select(answer => new AttemptAnswerView(answer.QuestionId, answer.Outcome, answer.Score, answer.SubmittedAnswer,
            answer.ReferenceAnswer, answer.Explanation, new SourceRef(answer.YoutubeVideoId, answer.SourceStartMs, answer.SourceEndMs))).ToArray(), entity.SubmittedAtUtc);
}

public sealed record SubmitAttemptAnswer(string QuestionId, string? SelectedOptionId, string? AnswerText);
public sealed record SubmitQuizAttemptCommand(string ContractVersion, string ClientAttemptId, string QuizId, IReadOnlyList<SubmitAttemptAnswer> Answers);
public sealed record AttemptAnswerView(string QuestionId, string Outcome, double Score, string SubmittedAnswer, string ReferenceAnswer, string Explanation, SourceRef Source);
public sealed record QuizAttemptView(string QuizAttemptId, string QuizId, double Score, IReadOnlyList<AttemptAnswerView> Results, DateTimeOffset SubmittedAtUtc);
public sealed record QuizAttemptResult(QuizAttemptView? Attempt, string? ErrorCode, string? ErrorMessage, int StatusCode)
{
    public static QuizAttemptResult Success(QuizAttemptView attempt) => new(attempt, null, null, StatusCodes.Status200OK);
    public static QuizAttemptResult Invalid(string code, string message) => new(null, code, message, StatusCodes.Status400BadRequest);
    public static QuizAttemptResult NotFound(string code, string message) => new(null, code, message, StatusCodes.Status404NotFound);
    public static QuizAttemptResult Conflict() => new(null, "idempotencyConflict", "The client attempt ID was reused with different answers.", StatusCodes.Status409Conflict);
    public static QuizAttemptResult Unavailable(string code, string message) => new(null, code, message, StatusCodes.Status503ServiceUnavailable);
}

public sealed record SubmitAnswerCommand(string ContractVersion, string ClientAttemptId, string QuizId, string QuestionId, string? SelectedOptionId, string? AnswerText);
public sealed record GradeData(string Outcome, double Score, string ReferenceAnswer, string Explanation);
public sealed record GradeView(string AnswerAttemptId, string QuestionId, string Outcome, double Score, string ReferenceAnswer, string Explanation, SourceRef Source, DateTimeOffset GradedAtUtc);
public sealed record SourceRef(string YoutubeVideoId, long StartMs, long EndMs);
public sealed record HistoryItem(string AnswerAttemptId, string YoutubeVideoId, string SessionId, string QuestionId, string QuestionPrompt, string QuestionType, string SubmittedAnswer, string Outcome, double Score, string Explanation, long TimestampMs, DateTimeOffset SubmittedAtUtc, string? QuizAttemptId = null, double? AttemptScore = null)
{
    public string? VideoTitle { get; init; }
    public string? VideoUrl { get; init; }
}
public sealed record AssessmentResult(GradeView? Grade, string? ErrorCode, string? ErrorMessage, int StatusCode)
{
    public static AssessmentResult Success(GradeView grade) => new(grade, null, null, StatusCodes.Status200OK);
    public static AssessmentResult Invalid(string code, string message) => new(null, code, message, StatusCodes.Status400BadRequest);
    public static AssessmentResult NotFound(string code, string message) => new(null, code, message, StatusCodes.Status404NotFound);
    public static AssessmentResult Conflict() => new(null, "idempotencyConflict", "The client attempt ID was reused with a different answer.", StatusCodes.Status409Conflict);
    public static AssessmentResult Unavailable(string code, string message) => new(null, code, message, StatusCodes.Status503ServiceUnavailable);
}
