using StudyLens.Api.Features.SessionQuiz.Application.Abstractions;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;

namespace StudyLens.Api.Features.SessionQuiz.Application;

public sealed class QuestionGenerationService
{
    private readonly IQuestionGenerationGateway _gateway;
    private readonly ISegmentRepository _segments;
    private readonly IQuestionAssessmentStore _assessmentStore;
    private readonly Dictionary<string, QuizPublicModel> _byId = new();

    public QuestionGenerationService(IQuestionGenerationGateway gateway, ISegmentRepository segments, IQuestionAssessmentStore? assessmentStore = null)
    {
        _gateway = gateway;
        _segments = segments;
        _assessmentStore = assessmentStore ?? new InMemoryQuestionAssessmentStore();
    }

    public async Task<QuizGenerationResult> GenerateAsync(GenerateQuizCommand command, CancellationToken cancellationToken)
    {
        if (!IsValid(command)) return QuizGenerationResult.Invalid("invalidQuizRequest", "A valid segment, video, and preferences are required.");
        var replay = await _assessmentStore.FindByIdempotencyKeyAsync(command.IdempotencyKey, cancellationToken);
        if (replay is not null)
            return replay.Quiz.SegmentId == command.SegmentId ? QuizGenerationResult.Success(replay.Quiz) : QuizGenerationResult.Conflict();

        var segment = _segments.FindById(command.SessionId, command.SegmentId);
        if (segment is null || segment.YoutubeVideoId != command.YoutubeVideoId)
            return QuizGenerationResult.NotFound("segmentNotFound", "The study segment was not found for this video.");

        var cues = segment.TranscriptCues
            .Select(cue => new TranscriptCue(cue.StartMs, cue.EndMs, cue.Text))
            .ToArray();
        if (cues.Length == 0 || cues.Any(cue => cue.StartMs < 0 || cue.EndMs <= cue.StartMs || string.IsNullOrWhiteSpace(cue.Text)))
            return QuizGenerationResult.Invalid("transcriptInsufficient", "The study segment does not contain usable transcript evidence.");

        var startMs = cues.Min(cue => cue.StartMs);
        var endMs = cues.Max(cue => cue.EndMs);
        var generated = await _gateway.GenerateAsync(new("0.4.0", "0.4.0", command.SegmentId, command.YoutubeVideoId, startMs, endMs, command.QuestionType, command.Difficulty, cues), cancellationToken);
        if (generated is null || generated.Questions.Count == 0) return QuizGenerationResult.Unavailable();

        var questions = generated.Questions
            .Where(question => IsValid(question, startMs, endMs))
            .Select(question => new GeneratedQuestionWithId(Guid.NewGuid().ToString(), question))
            .ToArray();
        if (questions.Length == 0) return QuizGenerationResult.Invalid("invalidAiOutput", "The AI response did not contain a valid question.");

        var quiz = new QuizPublicModel(Guid.NewGuid().ToString(), command.SessionId, command.SegmentId, "available", questions.Select(item =>
            new QuestionPublicModel(item.QuestionId, item.Question.Type, item.Question.Prompt,
                item.Question.Options?.Select(option => new QuestionOptionPublicModel(option.OptionId, option.Text)).ToArray(),
                new QuestionSourceRef(command.YoutubeVideoId, item.Question.SourceStartMs, item.Question.SourceEndMs))).ToArray(), DateTimeOffset.UtcNow);
        var record = new QuizAssessmentRecord(command.IdempotencyKey, quiz, questions.Select(item => new QuestionForAssessment(
            quiz.QuizId, quiz.SessionId, item.QuestionId, item.Question.Type, item.Question.Prompt,
            item.Question.CorrectOptionId, item.Question.Options?.Select(option => new QuestionOptionPublicModel(option.OptionId, option.Text)).ToArray(), item.Question.ReferenceAnswer, command.YoutubeVideoId,
            item.Question.SourceStartMs, item.Question.SourceEndMs)).ToArray());
        await _assessmentStore.SaveAsync(record, cancellationToken);
        _byId[quiz.QuizId] = quiz;
        return QuizGenerationResult.Success(quiz);
    }

    public async Task<QuizPublicModel?> GetAsync(string quizId, CancellationToken cancellationToken)
    {
        if (_byId.TryGetValue(quizId, out var quiz)) return quiz;
        return await _assessmentStore.FindQuizAsync(quizId, cancellationToken);
    }

    private static bool IsValid(GenerateQuizCommand command) =>
        !string.IsNullOrWhiteSpace(command.SessionId) && !string.IsNullOrWhiteSpace(command.SegmentId) &&
        !string.IsNullOrWhiteSpace(command.YoutubeVideoId) && !string.IsNullOrWhiteSpace(command.IdempotencyKey) &&
        command.QuestionType is "multipleChoice" or "shortAnswer" && command.Difficulty is "easy" or "medium" or "hard";

    private static bool IsValid(GeneratedQuestion question, long segmentStartMs, long segmentEndMs) =>
        question.Type is "multipleChoice" or "shortAnswer" && !string.IsNullOrWhiteSpace(question.Prompt) &&
        question.SourceStartMs >= segmentStartMs && question.SourceEndMs <= segmentEndMs && question.SourceEndMs > question.SourceStartMs &&
        (question.Type == "multipleChoice"
            ? question.Options is { Count: >= 2 } && !string.IsNullOrWhiteSpace(question.CorrectOptionId) &&
              question.Options.Any(option => option.OptionId == question.CorrectOptionId) &&
              question.Options.All(option => !string.IsNullOrWhiteSpace(option.OptionId) && !string.IsNullOrWhiteSpace(option.Text))
            : !string.IsNullOrWhiteSpace(question.ReferenceAnswer));
}

internal sealed record GeneratedQuestionWithId(string QuestionId, GeneratedQuestion Question);

public sealed record TranscriptCue(long StartMs, long EndMs, string Text);
public sealed record GenerateQuizCommand(string SessionId, string SegmentId, string YoutubeVideoId, string QuestionType, string Difficulty, string IdempotencyKey);
public sealed record QuizPublicModel(string QuizId, string SessionId, string SegmentId, string Status, IReadOnlyList<QuestionPublicModel> Questions, DateTimeOffset CreatedAtUtc);
public sealed record QuestionPublicModel(string QuestionId, string Type, string Prompt, IReadOnlyList<QuestionOptionPublicModel>? Options, QuestionSourceRef Source);
public sealed record QuestionOptionPublicModel(string OptionId, string Text);
public sealed record QuestionSourceRef(string YoutubeVideoId, long StartMs, long EndMs);
public sealed record QuizGenerationResult(QuizPublicModel? Quiz, string? ErrorCode, string? ErrorMessage, int StatusCode)
{
    public static QuizGenerationResult Success(QuizPublicModel quiz) => new(quiz, null, null, StatusCodes.Status200OK);
    public static QuizGenerationResult Invalid(string code, string message) => new(null, code, message, StatusCodes.Status400BadRequest);
    public static QuizGenerationResult Conflict() => new(null, "idempotencyConflict", "The idempotency key was used for another segment.", StatusCodes.Status409Conflict);
    public static QuizGenerationResult NotFound(string code, string message) => new(null, code, message, StatusCodes.Status404NotFound);
    public static QuizGenerationResult Unavailable() => new(null, "questionGenerationUnavailable", "Question generation is temporarily unavailable.", StatusCodes.Status503ServiceUnavailable);
}
