using System.Collections.Concurrent;

namespace StudyLens.Api.Features.SessionQuiz.Application;

public sealed class QuestionGenerationService
{
    private readonly IQuestionGenerationGateway _gateway;
    private readonly ConcurrentDictionary<string, QuizPublicModel> _byIdempotencyKey = new();
    private readonly ConcurrentDictionary<string, QuizPublicModel> _byId = new();

    public QuestionGenerationService(IQuestionGenerationGateway gateway) => _gateway = gateway;

    public async Task<QuizGenerationResult> GenerateAsync(GenerateQuizCommand command, CancellationToken cancellationToken)
    {
        if (!IsValid(command)) return QuizGenerationResult.Invalid("invalidQuizRequest", "A valid segment, video, preferences, and transcript cues are required.");
        if (_byIdempotencyKey.TryGetValue(command.IdempotencyKey, out var replay))
            return replay.SegmentId == command.SegmentId ? QuizGenerationResult.Success(replay) : QuizGenerationResult.Conflict();

        var startMs = command.Cues.Min(cue => cue.StartMs);
        var endMs = command.Cues.Max(cue => cue.EndMs);
        var generated = await _gateway.GenerateAsync(new("0.1.0", "0.1.0", command.SegmentId, command.YoutubeVideoId, startMs, endMs, command.QuestionType, command.Difficulty, command.Cues), cancellationToken);
        if (generated is null || generated.Questions.Count == 0) return QuizGenerationResult.Unavailable();

        var questions = generated.Questions
            .Where(question => IsValid(question, startMs, endMs))
            .Select(question => new QuestionPublicModel(Guid.NewGuid().ToString(), question.Type, question.Prompt, question.Options?.Select(option => new QuestionOptionPublicModel(option.OptionId, option.Text)).ToArray(), new QuestionSourceRef(command.YoutubeVideoId, question.SourceStartMs, question.SourceEndMs)))
            .ToArray();
        if (questions.Length == 0) return QuizGenerationResult.Invalid("invalidAiOutput", "The AI response did not contain a valid question.");

        var quiz = new QuizPublicModel(Guid.NewGuid().ToString(), command.SessionId, command.SegmentId, "available", questions, DateTimeOffset.UtcNow);
        var stored = _byIdempotencyKey.GetOrAdd(command.IdempotencyKey, quiz);
        _byId.TryAdd(stored.QuizId, stored);
        return QuizGenerationResult.Success(stored);
    }

    public QuizPublicModel? Get(string quizId) => _byId.TryGetValue(quizId, out var quiz) ? quiz : null;

    private static bool IsValid(GenerateQuizCommand command) =>
        !string.IsNullOrWhiteSpace(command.SessionId) && !string.IsNullOrWhiteSpace(command.SegmentId) &&
        !string.IsNullOrWhiteSpace(command.YoutubeVideoId) && !string.IsNullOrWhiteSpace(command.IdempotencyKey) &&
        command.QuestionType is "multipleChoice" or "shortAnswer" && command.Difficulty is "easy" or "medium" or "hard" &&
        command.Cues.Count > 0 && command.Cues.All(cue => cue.StartMs >= 0 && cue.EndMs > cue.StartMs && !string.IsNullOrWhiteSpace(cue.Text));

    private static bool IsValid(GeneratedQuestion question, long segmentStartMs, long segmentEndMs) =>
        question.Type is "multipleChoice" or "shortAnswer" && !string.IsNullOrWhiteSpace(question.Prompt) &&
        question.SourceStartMs >= segmentStartMs && question.SourceEndMs <= segmentEndMs && question.SourceEndMs > question.SourceStartMs &&
        (question.Type == "multipleChoice"
            ? question.Options is { Count: >= 2 } && !string.IsNullOrWhiteSpace(question.CorrectOptionId) &&
              question.Options.Any(option => option.OptionId == question.CorrectOptionId) &&
              question.Options.All(option => !string.IsNullOrWhiteSpace(option.OptionId) && !string.IsNullOrWhiteSpace(option.Text))
            : !string.IsNullOrWhiteSpace(question.ReferenceAnswer));
}

public sealed record TranscriptCue(long StartMs, long EndMs, string Text);
public sealed record GenerateQuizCommand(string SessionId, string SegmentId, string YoutubeVideoId, string QuestionType, string Difficulty, IReadOnlyList<TranscriptCue> Cues, string IdempotencyKey);
public sealed record QuizPublicModel(string QuizId, string SessionId, string SegmentId, string Status, IReadOnlyList<QuestionPublicModel> Questions, DateTimeOffset CreatedAtUtc);
public sealed record QuestionPublicModel(string QuestionId, string Type, string Prompt, IReadOnlyList<QuestionOptionPublicModel>? Options, QuestionSourceRef Source);
public sealed record QuestionOptionPublicModel(string OptionId, string Text);
public sealed record QuestionSourceRef(string YoutubeVideoId, long StartMs, long EndMs);
public sealed record QuizGenerationResult(QuizPublicModel? Quiz, string? ErrorCode, string? ErrorMessage, int StatusCode)
{
    public static QuizGenerationResult Success(QuizPublicModel quiz) => new(quiz, null, null, StatusCodes.Status200OK);
    public static QuizGenerationResult Invalid(string code, string message) => new(null, code, message, StatusCodes.Status400BadRequest);
    public static QuizGenerationResult Conflict() => new(null, "idempotencyConflict", "The idempotency key was used for another segment.", StatusCodes.Status409Conflict);
    public static QuizGenerationResult Unavailable() => new(null, "questionGenerationUnavailable", "Question generation is temporarily unavailable.", StatusCodes.Status503ServiceUnavailable);
}
