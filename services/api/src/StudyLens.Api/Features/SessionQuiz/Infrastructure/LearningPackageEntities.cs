using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace StudyLens.Api.Features.SessionQuiz.Infrastructure;

public sealed class StudyVideoEntity
{
    public string YoutubeVideoId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset LastSeenAtUtc { get; set; }
}

public sealed class StudySessionEntity
{
    public string SessionId { get; set; } = string.Empty;
    public string ActivationId { get; set; } = string.Empty;
    public string StartIdempotencyKey { get; set; } = string.Empty;
    public string YoutubeVideoId { get; set; } = string.Empty;
    public string VideoTitle { get; set; } = string.Empty;
    public string QuestionType { get; set; } = "multipleChoice";
    public string Difficulty { get; set; } = "medium";
    public string Status { get; set; } = "active";
    public string TranscriptStatus { get; set; } = "waiting";
    public string QuizStatus { get; set; } = "notStarted";
    public string? TranscriptCaptureId { get; set; }
    public string? QuizId { get; set; }
    public string? TranscriptSubmissionKey { get; set; }
    public string? TranscriptSubmissionFingerprint { get; set; }
    public string? ErrorOperation { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    public bool ErrorRetryable { get; set; }
    public DateTimeOffset StartedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public string? CompletionId { get; set; }
    public string? CompletionReason { get; set; }
}

public sealed class ProcessingJobEntity
{
    public string ProcessingJobId { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public string JobType { get; set; } = string.Empty;
    public string Status { get; set; } = "queued";
    public string IdempotencyKey { get; set; } = string.Empty;
    public int AttemptCount { get; set; }
    public int MaxAttempts { get; set; } = 3;
    public string? LastErrorCode { get; set; }
    public string? LastErrorMessage { get; set; }
    public bool LastErrorRetryable { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

internal sealed class StudyVideoEntityConfiguration : IEntityTypeConfiguration<StudyVideoEntity>
{
    public void Configure(EntityTypeBuilder<StudyVideoEntity> builder)
    {
        builder.ToTable("Videos");
        builder.HasKey(item => item.YoutubeVideoId);
        builder.Property(item => item.YoutubeVideoId).HasMaxLength(32);
        builder.Property(item => item.Title).IsRequired();
    }
}

internal sealed class StudySessionEntityConfiguration : IEntityTypeConfiguration<StudySessionEntity>
{
    public void Configure(EntityTypeBuilder<StudySessionEntity> builder)
    {
        builder.ToTable("StudySessions");
        builder.HasKey(item => item.SessionId);
        builder.Property(item => item.SessionId).HasMaxLength(64);
        builder.Property(item => item.ActivationId).HasMaxLength(64).IsRequired();
        builder.Property(item => item.StartIdempotencyKey).HasMaxLength(200).IsRequired();
        builder.Property(item => item.YoutubeVideoId).HasMaxLength(32).IsRequired();
        builder.Property(item => item.QuestionType).HasMaxLength(32).IsRequired();
        builder.Property(item => item.Difficulty).HasMaxLength(16).IsRequired();
        builder.Property(item => item.Status).HasMaxLength(16).IsRequired();
        builder.Property(item => item.TranscriptStatus).HasMaxLength(16).IsRequired();
        builder.Property(item => item.QuizStatus).HasMaxLength(16).IsRequired();
        builder.Property(item => item.TranscriptSubmissionKey).HasMaxLength(200);
        builder.Property(item => item.TranscriptSubmissionFingerprint).HasMaxLength(64);
        builder.Property(item => item.ErrorOperation).HasMaxLength(32);
        builder.Property(item => item.ErrorCode).HasMaxLength(64);
        builder.HasIndex(item => item.ActivationId).IsUnique();
        builder.HasIndex(item => item.StartIdempotencyKey).IsUnique();
        builder.HasIndex(item => item.TranscriptSubmissionKey).IsUnique();
        builder.HasOne<StudyVideoEntity>().WithMany().HasForeignKey(item => item.YoutubeVideoId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class ProcessingJobEntityConfiguration : IEntityTypeConfiguration<ProcessingJobEntity>
{
    public void Configure(EntityTypeBuilder<ProcessingJobEntity> builder)
    {
        builder.ToTable("ProcessingJobs");
        builder.HasKey(item => item.ProcessingJobId);
        builder.Property(item => item.ProcessingJobId).HasMaxLength(64);
        builder.Property(item => item.SessionId).HasMaxLength(64).IsRequired();
        builder.Property(item => item.JobType).HasMaxLength(32).IsRequired();
        builder.Property(item => item.Status).HasMaxLength(16).IsRequired();
        builder.Property(item => item.IdempotencyKey).HasMaxLength(200).IsRequired();
        builder.Property(item => item.LastErrorCode).HasMaxLength(64);
        builder.HasIndex(item => item.IdempotencyKey).IsUnique();
        builder.HasIndex(item => new { item.Status, item.CreatedAtUtc });
        builder.HasOne<StudySessionEntity>().WithMany().HasForeignKey(item => item.SessionId).OnDelete(DeleteBehavior.Cascade);
    }
}
