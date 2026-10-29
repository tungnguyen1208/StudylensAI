using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.AssessmentHistory.Infrastructure;
using StudyLens.Api.Features.SessionQuiz.Application.Abstractions;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;
using StudyLens.Api.Features.Accounts.Application;

namespace StudyLens.Api.Features.AssessmentHistory.Application;

public sealed class AssessmentHistoryService(
    AssessmentHistoryDbContext db,
    IQuestionAssessmentReader questions,
    IShortAnswerGradingGateway shortAnswers,
    StudyLensDbContext? rootDb = null,
    QuotaService? quota = null)
{
    public Task<QuizAttemptResult> SubmitAttemptAsync(SubmitQuizAttemptCommand command, CancellationToken cancellationToken) =>
        SubmitAttemptAsync(string.Empty, command, cancellationToken);

    public async Task<QuizAttemptResult> SubmitAttemptAsync(string userId, SubmitQuizAttemptCommand command, CancellationToken cancellationToken)
    {
        if (command.ContractVersion != "0.7.0" || !Guid.TryParse(command.ClientAttemptId, out _) || command.Answers.Count == 0 ||
            command.Answers.Select(item => item.QuestionId).Distinct(StringComparer.Ordinal).Count() != command.Answers.Count)
            return QuizAttemptResult.Invalid("invalidAttemptRequest", "A complete 0.7.0 quiz attempt is required.");

        var existing = await db.QuizAttempts.AsNoTracking().Include(item => item.Answers)
            .SingleOrDefaultAsync(item => item.UserId == userId && item.ClientAttemptId == command.ClientAttemptId, cancellationToken);
        if (existing is not null)
            return existing.Answers.All(ValidEvidenceSource)
                ? SameAttempt(existing, command) ? QuizAttemptResult.Success(ToAttemptView(existing)) : QuizAttemptResult.Conflict()
                : QuizAttemptResult.Invalid("invalidEvidenceSource", "The stored quiz attempt has an invalid evidence source.");

        var database = rootDb ?? db.RootDb;
        var quiz = await database.Set<QuizAssessmentEntity>().AsNoTracking().Include(item => item.Questions).ThenInclude(item => item.Options)
            .SingleOrDefaultAsync(item => item.QuizId == command.QuizId && item.UserId == userId, cancellationToken);
        if (quiz is null) return QuizAttemptResult.NotFound("quizNotFound", "The quiz was not found.");
        if (!ValidYoutubeVideoId(quiz.YoutubeVideoId) || quiz.Questions.Any(question =>
                question.YoutubeVideoId != quiz.YoutubeVideoId ||
                !ValidEvidenceSource(question.YoutubeVideoId, question.SourceStartMs, question.SourceEndMs)))
            return QuizAttemptResult.Invalid("invalidEvidenceSource", "Every quiz question requires a valid YouTube evidence range.");
        if (quiz.Status != "ready")
            return QuizAttemptResult.Invalid("quizNotReady", "The quiz is not ready for this video.");
        var session = await database.Set<StudySessionEntity>().SingleOrDefaultAsync(item => item.SessionId == quiz.SessionId && item.UserId == userId, cancellationToken);
        if (session is null || session.Status is not ("active" or "closed" or "completed") || session.QuizStatus != "ready" ||
            session.QuizId != quiz.QuizId || session.YoutubeVideoId != quiz.YoutubeVideoId)
            return QuizAttemptResult.Invalid("sessionNotReady", "The video session is not ready for a quiz attempt.");
        if (quiz.Questions.Count != command.Answers.Count || quiz.Questions.Any(question => command.Answers.All(answer => answer.QuestionId != question.QuestionId)))
            return QuizAttemptResult.Invalid("incompleteAttempt", "Every quiz question must be answered exactly once.");

        foreach (var question in quiz.Questions)
        {
            var submitted = command.Answers.Single(item => item.QuestionId == question.QuestionId);
            if (!ValidAnswer(question.Type, submitted))
                return QuizAttemptResult.Invalid("invalidAnswer", "An answer does not match its question type.");
            if (question.Type == "multipleChoice" && question.Options.All(item => item.OptionId != submitted.SelectedOptionId))
                return QuizAttemptResult.Invalid("invalidOption", "A selected option does not belong to its quiz question.");
            if (question.Type == "shortAnswer" && string.IsNullOrWhiteSpace(question.ReferenceAnswer))
                return QuizAttemptResult.Invalid("missingReferenceAnswer", "The short-answer question cannot be graded.");
        }

        var shortAnswerCount = quiz.Questions.Count(question => question.Type == "shortAnswer");
        string? gradingReservationId = null;
        if (quota is not null && !string.IsNullOrWhiteSpace(userId) && shortAnswerCount > 0)
        {
            var decision = await quota.ReserveAsync(userId, QuotaService.ShortAnswerGrade,
                $"attempt:{command.ClientAttemptId}", shortAnswerCount, cancellationToken);
            if (!decision.Allowed) return QuizAttemptResult.QuotaExceeded(decision.Counter);
            gradingReservationId = decision.ReservationId;
        }

        var attemptId = Guid.NewGuid().ToString();
        var graded = new List<AttemptAnswerEntity>(quiz.Questions.Count);
        foreach (var question in quiz.Questions)
        {
            var submitted = command.Answers.Single(item => item.QuestionId == question.QuestionId);
            GradeData? grade;
            if (question.Type == "multipleChoice")
            {
                var correct = submitted.SelectedOptionId == question.CorrectOptionId;
                var reference = question.Options.SingleOrDefault(item => item.OptionId == question.CorrectOptionId)?.Text ?? string.Empty;
                grade = new GradeData(correct ? "correct" : "incorrect", correct ? 1 : 0, reference,
                    string.IsNullOrWhiteSpace(question.Explanation) ? (correct ? "The selected answer is correct." : "Review the referenced video passage.") : question.Explanation);
            }
            else
            {
                ShortAnswerGradingResult grading;
                try
                {
                    grading = await shortAnswers.GradeAsync(new("0.5.0", question.QuestionId, question.Prompt,
                        question.ReferenceAnswer!, submitted.AnswerText!), cancellationToken);
                }
                catch
                {
                    if (quota is not null) await quota.ReleaseAsync(gradingReservationId, cancellationToken);
                    throw;
                }
                if (grading.Grade is null || !IsValidShortAnswerGrade(grading.Grade))
                {
                    if (quota is not null) await quota.ReleaseAsync(gradingReservationId, cancellationToken);
                    return QuizAttemptResult.Unavailable(
                        grading.ErrorCode ?? "gradingUnavailable",
                        grading.ErrorMessage ?? "Short-answer grading is temporarily unavailable.",
                        grading.Retryable);
                }
                grade = new GradeData(grading.Grade.Outcome, grading.Grade.Score, grading.Grade.ReferenceAnswer, grading.Grade.Explanation);
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
            UserId = userId,
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
                .SingleOrDefaultAsync(item => item.UserId == userId && item.ClientAttemptId == command.ClientAttemptId, cancellationToken);
            if (existing is not null)
            {
                if (quota is not null) await quota.ConsumeAsync(gradingReservationId, cancellationToken);
                return SameAttempt(existing, command) ? QuizAttemptResult.Success(ToAttemptView(existing)) : QuizAttemptResult.Conflict();
            }
            if (quota is not null) await quota.ReleaseAsync(gradingReservationId, cancellationToken);
            throw;
        }
        catch
        {
            if (quota is not null) await quota.ReleaseAsync(gradingReservationId, cancellationToken);
            throw;
        }
        if (quota is not null) await quota.ConsumeAsync(gradingReservationId, cancellationToken);
        return QuizAttemptResult.Success(ToAttemptView(attempt));
    }

    public Task<AssessmentResult> SubmitAsync(SubmitAnswerCommand command, CancellationToken cancellationToken) =>
        SubmitAsync(string.Empty, command, cancellationToken);

    public async Task<AssessmentResult> SubmitAsync(string userId, SubmitAnswerCommand command, CancellationToken cancellationToken)
    {
        if (command.ContractVersion != "0.7.0" || string.IsNullOrWhiteSpace(command.ClientAttemptId) || string.IsNullOrWhiteSpace(command.QuestionId))
            return AssessmentResult.Invalid("invalidAnswerRequest", "A valid answer request is required.");

        var existing = await db.AnswerAttempts.SingleOrDefaultAsync(item => item.UserId == userId && item.ClientAttemptId == command.ClientAttemptId, cancellationToken);
        if (existing is not null)
            return ValidEvidenceSource(existing)
                ? SameSubmission(existing, command) ? AssessmentResult.Success(ToGrade(existing)) : AssessmentResult.Conflict()
                : AssessmentResult.Invalid("invalidEvidenceSource", "The stored answer has an invalid evidence source.");

        var database = rootDb ?? db.RootDb;
        if (!string.IsNullOrWhiteSpace(userId))
        {
            var ownsQuiz = await database.Set<QuizAssessmentEntity>().AsNoTracking()
                .AnyAsync(item => item.QuizId == command.QuizId && item.UserId == userId, cancellationToken);
            if (!ownsQuiz) return AssessmentResult.NotFound("quizNotFound", "The quiz was not found.");
        }

        var question = await questions.FindAsync(command.QuizId, command.QuestionId, cancellationToken);
        if (question is null) return AssessmentResult.NotFound("questionNotFound", "The quiz question was not found.");
        if (!ValidEvidenceSource(question.YoutubeVideoId, question.SourceStartMs, question.SourceEndMs))
            return AssessmentResult.Invalid("invalidEvidenceSource", "The question requires a valid YouTube evidence range.");
        if (!IsValidAnswer(question.Type, command)) return AssessmentResult.Invalid("invalidAnswer", "The submitted answer does not match the question type.");
        if (question.Type == "multipleChoice" && !ContainsOption(question, command.SelectedOptionId!))
            return AssessmentResult.Invalid("invalidOption", "The selected option does not belong to the quiz question.");
        if (question.Type == "shortAnswer" && string.IsNullOrWhiteSpace(question.ReferenceAnswer))
            return AssessmentResult.Invalid("missingReferenceAnswer", "The short-answer question cannot be graded.");

        string? gradingReservationId = null;
        if (quota is not null && !string.IsNullOrWhiteSpace(userId) && question.Type == "shortAnswer")
        {
            var decision = await quota.ReserveAsync(userId, QuotaService.ShortAnswerGrade,
                $"answer:{command.ClientAttemptId}", 1, cancellationToken);
            if (!decision.Allowed) return AssessmentResult.QuotaExceeded(decision.Counter);
            gradingReservationId = decision.ReservationId;
        }
        GradeData grade;
        if (question.Type == "multipleChoice")
        {
            grade = GradeMultipleChoice(question, command.SelectedOptionId!);
        }
        else
        {
            ShortAnswerGradingResult grading;
            try
            {
                grading = await shortAnswers.GradeAsync(new(
                    "0.5.0", question.QuestionId, question.Prompt, question.ReferenceAnswer!, command.AnswerText!), cancellationToken);
            }
            catch
            {
                if (quota is not null) await quota.ReleaseAsync(gradingReservationId, cancellationToken);
                throw;
            }
            if (grading.Grade is null || !IsValidShortAnswerGrade(grading.Grade))
            {
                if (quota is not null) await quota.ReleaseAsync(gradingReservationId, cancellationToken);
                return AssessmentResult.Unavailable(
                    grading.ErrorCode ?? "gradingUnavailable",
                    grading.ErrorMessage ?? "Answer grading is temporarily unavailable.",
                    grading.Retryable);
            }
            grade = new GradeData(grading.Grade.Outcome, grading.Grade.Score, grading.Grade.ReferenceAnswer, grading.Grade.Explanation);
        }

        var attempt = new AnswerAttemptEntity
        {
            UserId = userId,
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
            existing = await db.AnswerAttempts.SingleOrDefaultAsync(item => item.UserId == userId && item.ClientAttemptId == command.ClientAttemptId, cancellationToken);
            if (existing is not null)
            {
                if (quota is not null) await quota.ConsumeAsync(gradingReservationId, cancellationToken);
                return SameSubmission(existing, command) ? AssessmentResult.Success(ToGrade(existing)) : AssessmentResult.Conflict();
            }
            if (quota is not null) await quota.ReleaseAsync(gradingReservationId, cancellationToken);
            throw;
        }
        catch
        {
            if (quota is not null) await quota.ReleaseAsync(gradingReservationId, cancellationToken);
            throw;
        }
        if (quota is not null) await quota.ConsumeAsync(gradingReservationId, cancellationToken);
        return AssessmentResult.Success(ToGrade(attempt));
    }

    public Task<IReadOnlyList<HistoryItem>> ReadHistoryAsync(string? youtubeVideoId, CancellationToken cancellationToken) =>
        ReadHistoryAsync(string.Empty, youtubeVideoId, cancellationToken);

    public async Task<IReadOnlyList<HistoryItem>> ReadHistoryAsync(string userId, string? youtubeVideoId, CancellationToken cancellationToken)
    {
        var database = rootDb ?? db.RootDb;
        if (!string.IsNullOrWhiteSpace(youtubeVideoId) && !ValidYoutubeVideoId(youtubeVideoId)) return [];

        var legacyQuery = db.AnswerAttempts.AsNoTracking().Where(item => item.UserId == userId);
        if (!string.IsNullOrWhiteSpace(youtubeVideoId)) legacyQuery = legacyQuery.Where(item => item.YoutubeVideoId == youtubeVideoId);
        var legacyRows = database.Database.IsSqlite()
            ? (await legacyQuery.ToArrayAsync(cancellationToken)).OrderByDescending(item => item.GradedAtUtc)
                .ThenBy(item => item.AnswerAttemptId, StringComparer.Ordinal).Take(200).ToArray()
            : await legacyQuery.OrderByDescending(item => item.GradedAtUtc)
                .ThenBy(item => item.AnswerAttemptId).Take(200).ToArrayAsync(cancellationToken);

        var attemptQuery = db.QuizAttempts.AsNoTracking().Include(item => item.Answers).Where(item => item.UserId == userId);
        if (!string.IsNullOrWhiteSpace(youtubeVideoId))
            attemptQuery = attemptQuery.Where(item => item.Answers.Any(answer => answer.YoutubeVideoId == youtubeVideoId));
        var attempts = database.Database.IsSqlite()
            ? (await attemptQuery.ToArrayAsync(cancellationToken)).OrderByDescending(item => item.SubmittedAtUtc)
                .ThenBy(item => item.QuizAttemptId, StringComparer.Ordinal).Take(100).ToArray()
            : await attemptQuery.OrderByDescending(item => item.SubmittedAtUtc)
                .ThenBy(item => item.QuizAttemptId).Take(100).ToArrayAsync(cancellationToken);
        var questionIds = attempts.SelectMany(item => item.Answers).Select(item => item.QuestionId).Distinct().ToArray();
        var questionPositions = questionIds.Length == 0
            ? new Dictionary<string, int>(StringComparer.Ordinal)
            : await database.Set<QuestionAssessmentEntity>().AsNoTracking()
                .Where(item => questionIds.Contains(item.QuestionId))
                .ToDictionaryAsync(item => item.QuestionId, item => item.Position, StringComparer.Ordinal, cancellationToken);

        var groups = new List<HistoryGroup>();
        groups.AddRange(legacyRows.Where(ValidEvidenceSource).Select(item => new HistoryGroup(
            item.GradedAtUtc, item.AnswerAttemptId,
            [new HistoryItem(item.AnswerAttemptId, item.YoutubeVideoId, item.SessionId, item.QuestionId, item.QuestionPrompt,
                item.QuestionType, item.SubmittedAnswer, item.ReferenceAnswer, item.Outcome, item.Score, item.Explanation,
                item.SourceStartMs, item.GradedAtUtc, null, null)])));
        groups.AddRange(attempts.Where(item => item.Answers.Count > 0 && item.Answers.All(answer =>
                ValidEvidenceSource(answer) && answer.YoutubeVideoId == item.Answers[0].YoutubeVideoId &&
                (string.IsNullOrWhiteSpace(youtubeVideoId) || answer.YoutubeVideoId == youtubeVideoId))).Select(attempt =>
            new HistoryGroup(attempt.SubmittedAtUtc, attempt.QuizAttemptId, attempt.Answers
                .OrderBy(answer => questionPositions.GetValueOrDefault(answer.QuestionId, int.MaxValue))
                .ThenBy(answer => answer.QuestionId, StringComparer.Ordinal)
                .Select(answer => new HistoryItem(answer.AttemptAnswerId, answer.YoutubeVideoId, attempt.SessionId,
                    answer.QuestionId, answer.QuestionPrompt, answer.QuestionType, answer.SubmittedAnswer,
                    answer.ReferenceAnswer, answer.Outcome, answer.Score, answer.Explanation, answer.SourceStartMs,
                    attempt.SubmittedAtUtc, attempt.QuizAttemptId, attempt.Score)).ToArray())));

        var selected = new List<HistoryItem>(100);
        foreach (var group in groups.OrderByDescending(item => item.SubmittedAtUtc).ThenBy(item => item.StableId, StringComparer.Ordinal))
        {
            if (group.Items.Count > 100 || selected.Count + group.Items.Count > 100) break;
            selected.AddRange(group.Items);
        }
        var items = selected.ToArray();
        if (items.Length == 0) return items;

        var sessionIds = items.Select(item => item.SessionId).Distinct().ToArray();
        var videoIds = items.Select(item => item.YoutubeVideoId).Distinct().ToArray();
        var sessionTitles = await database.Set<StudySessionEntity>().AsNoTracking()
            .Where(item => item.UserId == userId && sessionIds.Contains(item.SessionId))
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

    private static bool ValidEvidenceSource(string youtubeVideoId, long startMs, long endMs) =>
        ValidYoutubeVideoId(youtubeVideoId) && startMs >= 0 && endMs > startMs;

    private static bool ValidEvidenceSource(AttemptAnswerEntity item) =>
        ValidEvidenceSource(item.YoutubeVideoId, item.SourceStartMs, item.SourceEndMs);

    private static bool ValidEvidenceSource(AnswerAttemptEntity item) =>
        ValidEvidenceSource(item.YoutubeVideoId, item.SourceStartMs, item.SourceEndMs);

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

internal sealed record HistoryGroup(DateTimeOffset SubmittedAtUtc, string StableId, IReadOnlyList<HistoryItem> Items);

public sealed record SubmitAttemptAnswer(string QuestionId, string? SelectedOptionId, string? AnswerText);
public sealed record SubmitQuizAttemptCommand(string ContractVersion, string ClientAttemptId, string QuizId, IReadOnlyList<SubmitAttemptAnswer> Answers);
public sealed record AttemptAnswerView(string QuestionId, string Outcome, double Score, string SubmittedAnswer, string ReferenceAnswer, string Explanation, SourceRef Source);
public sealed record QuizAttemptView(string QuizAttemptId, string QuizId, double Score, IReadOnlyList<AttemptAnswerView> Results, DateTimeOffset SubmittedAtUtc);
public sealed record QuizAttemptResult(QuizAttemptView? Attempt, string? ErrorCode, string? ErrorMessage, int StatusCode, bool Retryable,
    DateTimeOffset? ResetAtUtc = null)
{
    public static QuizAttemptResult Success(QuizAttemptView attempt) => new(attempt, null, null, StatusCodes.Status200OK, false);
    public static QuizAttemptResult Invalid(string code, string message) => new(null, code, message, StatusCodes.Status400BadRequest, false);
    public static QuizAttemptResult NotFound(string code, string message) => new(null, code, message, StatusCodes.Status404NotFound, false);
    public static QuizAttemptResult Conflict() => new(null, "idempotencyConflict", "The client attempt ID was reused with different answers.", StatusCodes.Status409Conflict, false);
    public static QuizAttemptResult Unavailable(string code, string message, bool retryable) => new(null, code, message, StatusCodes.Status503ServiceUnavailable, retryable);
    public static QuizAttemptResult QuotaExceeded(QuotaCounterView counter) => new(null, "quotaExceeded",
        "The daily short-answer grading quota has been reached.", StatusCodes.Status429TooManyRequests, true, counter.ResetAtUtc);
}

public sealed record SubmitAnswerCommand(string ContractVersion, string ClientAttemptId, string QuizId, string QuestionId, string? SelectedOptionId, string? AnswerText);
public sealed record GradeData(string Outcome, double Score, string ReferenceAnswer, string Explanation);
public sealed record GradeView(string AnswerAttemptId, string QuestionId, string Outcome, double Score, string ReferenceAnswer, string Explanation, SourceRef Source, DateTimeOffset GradedAtUtc);
public sealed record SourceRef(string YoutubeVideoId, long StartMs, long EndMs);
public sealed record HistoryItem(string AnswerAttemptId, string YoutubeVideoId, string SessionId, string QuestionId, string QuestionPrompt, string QuestionType, string SubmittedAnswer, string ReferenceAnswer, string Outcome, double Score, string Explanation, long TimestampMs, DateTimeOffset SubmittedAtUtc, string? QuizAttemptId = null, double? AttemptScore = null)
{
    public string? VideoTitle { get; init; }
    public string? VideoUrl { get; init; }
}
public sealed record AssessmentResult(GradeView? Grade, string? ErrorCode, string? ErrorMessage, int StatusCode, bool Retryable,
    DateTimeOffset? ResetAtUtc = null)
{
    public static AssessmentResult Success(GradeView grade) => new(grade, null, null, StatusCodes.Status200OK, false);
    public static AssessmentResult Invalid(string code, string message) => new(null, code, message, StatusCodes.Status400BadRequest, false);
    public static AssessmentResult NotFound(string code, string message) => new(null, code, message, StatusCodes.Status404NotFound, false);
    public static AssessmentResult Conflict() => new(null, "idempotencyConflict", "The client attempt ID was reused with a different answer.", StatusCodes.Status409Conflict, false);
    public static AssessmentResult Unavailable(string code, string message, bool retryable) => new(null, code, message, StatusCodes.Status503ServiceUnavailable, retryable);
    public static AssessmentResult QuotaExceeded(QuotaCounterView counter) => new(null, "quotaExceeded",
        "The daily short-answer grading quota has been reached.", StatusCodes.Status429TooManyRequests, true, counter.ResetAtUtc);
}
