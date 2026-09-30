namespace StudyLens.Api.Features.SessionQuiz.Application;

/**
 * Backend-only quiz projections shared by assessment persistence and history.
 * SegmentId is retained solely to read legacy QuizAssessments rows; new
 * full-video quizzes persist an empty value and never expose a segment API.
 */
public sealed record QuizPublicModel(
    string QuizId,
    string SessionId,
    string SegmentId,
    string Status,
    IReadOnlyList<QuestionPublicModel> Questions,
    DateTimeOffset CreatedAtUtc);

public sealed record QuestionPublicModel(
    string QuestionId,
    string Type,
    string Prompt,
    IReadOnlyList<QuestionOptionPublicModel>? Options,
    QuestionSourceRef Source);

public sealed record QuestionOptionPublicModel(string OptionId, string Text);
public sealed record QuestionSourceRef(string YoutubeVideoId, long StartMs, long EndMs);
