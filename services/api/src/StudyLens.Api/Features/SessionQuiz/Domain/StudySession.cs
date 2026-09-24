namespace StudyLens.Api.Features.SessionQuiz.Domain;

public sealed record StudySession(
    string SessionId,
    string ActivationId,
    string YoutubeVideoId,
    string? TranscriptCaptureId,
    int QuizIntervalMinutes,
    string QuestionType,
    string Difficulty,
    string Status,
    long ActiveStudyMs,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset? CompletedAtUtc,
    string? CompletionId,
    string? CompletionReason);
