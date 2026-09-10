using System.Collections.Concurrent;
using StudyLens.Api.Features.SessionQuiz.Domain;

namespace StudyLens.Api.Features.SessionQuiz.Application;

public sealed class StudySessionService
{
    private readonly ConcurrentDictionary<string, StudySession> _byDecision = new();
    private readonly ConcurrentDictionary<string, StudySession> _byId = new();

    public StudySessionResult Start(StartStudySessionCommand command)
    {
        if (command.State != "active") return StudySessionResult.Invalid("activationInactive", "Only an active activation decision can start a session.");
        if (string.IsNullOrWhiteSpace(command.DecisionId) || string.IsNullOrWhiteSpace(command.YoutubeVideoId)) return StudySessionResult.Invalid("invalidSession", "Decision and YouTube video identifiers are required.");
        if (command.QuizIntervalMinutes is not (5 or 10 or 15)) return StudySessionResult.Invalid("invalidPreferences", "Quiz interval must be 5, 10, or 15 minutes.");
        var candidate = new StudySession(Guid.NewGuid().ToString(), command.DecisionId, command.YoutubeVideoId, command.TranscriptSnapshotId, command.QuizIntervalMinutes, command.QuestionType, command.Difficulty, "active", 0, DateTimeOffset.UtcNow, null, null, null);
        var stored = _byDecision.GetOrAdd(command.DecisionId, candidate);
        if (stored.YoutubeVideoId != command.YoutubeVideoId) return StudySessionResult.Conflict("decisionConflict", "The activation decision was already used for another video.");
        _byId.TryAdd(stored.SessionId, stored);
        return StudySessionResult.Success(stored);
    }

    public StudySessionResult Complete(CompleteStudySessionCommand command)
    {
        if (!_byId.TryGetValue(command.SessionId, out var current)) return StudySessionResult.NotFound();
        if (command.ActiveStudyMs < 0 || string.IsNullOrWhiteSpace(command.ClientCompletionId)) return StudySessionResult.Invalid("invalidCompletion", "Completion ID and non-negative active study time are required.");
        if (current.Status == "completed") return current.CompletionId == command.ClientCompletionId ? StudySessionResult.Success(current) : StudySessionResult.Conflict("completionConflict", "The session was already completed by another request.");
        var completed = current with { Status = "completed", ActiveStudyMs = command.ActiveStudyMs, CompletedAtUtc = DateTimeOffset.UtcNow, CompletionId = command.ClientCompletionId, CompletionReason = command.Reason };
        _byId[command.SessionId] = completed;
        _byDecision[completed.DecisionId] = completed;
        return StudySessionResult.Success(completed);
    }
}

public sealed record StartStudySessionCommand(string DecisionId, string State, string YoutubeVideoId, string? TranscriptSnapshotId, int QuizIntervalMinutes, string QuestionType, string Difficulty);
public sealed record CompleteStudySessionCommand(string SessionId, string ClientCompletionId, string Reason, long ActiveStudyMs);
public sealed record StudySessionResult(StudySession? Session, string? ErrorCode, string? ErrorMessage, int StatusCode)
{
    public static StudySessionResult Success(StudySession session) => new(session, null, null, StatusCodes.Status200OK);
    public static StudySessionResult Invalid(string code, string message) => new(null, code, message, StatusCodes.Status400BadRequest);
    public static StudySessionResult Conflict(string code, string message) => new(null, code, message, StatusCodes.Status409Conflict);
    public static StudySessionResult NotFound() => new(null, "sessionNotFound", "Study session was not found.", StatusCodes.Status404NotFound);
}
