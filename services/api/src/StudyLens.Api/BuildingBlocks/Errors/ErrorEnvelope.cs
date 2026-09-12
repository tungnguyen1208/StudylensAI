namespace StudyLens.Api.BuildingBlocks.Errors;

public record ErrorEnvelope(
    string Code,
    int Status,
    string Message,
    string? TraceId = null,
    bool Retryable = false);
