namespace StudyLens.Api.AI;

public sealed class AIServiceOptions
{
    public const string SectionName = "AIService";

    public string BaseUrl { get; init; } = "http://localhost:8000";
}

