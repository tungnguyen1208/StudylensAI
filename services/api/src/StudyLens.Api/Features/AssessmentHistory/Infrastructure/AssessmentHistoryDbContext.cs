using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StudyLens.Api.Infrastructure.Persistence;

namespace StudyLens.Api.Features.AssessmentHistory.Infrastructure;

public sealed class AnswerAttemptEntity
{
    public string AnswerAttemptId { get; set; } = string.Empty;
    public string ClientAttemptId { get; set; } = string.Empty;
    public string QuizId { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public string QuestionId { get; set; } = string.Empty;
    public string YoutubeVideoId { get; set; } = string.Empty;
    public string QuestionPrompt { get; set; } = string.Empty;
    public string QuestionType { get; set; } = string.Empty;
    public string SubmittedAnswer { get; set; } = string.Empty;
    public string Outcome { get; set; } = string.Empty;
    public double Score { get; set; }
    public string ReferenceAnswer { get; set; } = string.Empty;
    public string Explanation { get; set; } = string.Empty;
    public long SourceStartMs { get; set; }
    public long SourceEndMs { get; set; }
    public DateTimeOffset GradedAtUtc { get; set; }
}

public sealed class AssessmentHistoryDbContext(StudyLensDbContext db)
{
    public DbSet<AnswerAttemptEntity> AnswerAttempts => db.Set<AnswerAttemptEntity>();
    public Task<int> SaveChangesAsync(CancellationToken cancellationToken) => db.SaveChangesAsync(cancellationToken);
    public void Detach(AnswerAttemptEntity entity) => db.Entry(entity).State = EntityState.Detached;
}

public sealed class AnswerAttemptEntityConfiguration : IEntityTypeConfiguration<AnswerAttemptEntity>
{
    public void Configure(EntityTypeBuilder<AnswerAttemptEntity> builder)
    {
        builder.ToTable("AnswerAttempts");
        builder.HasKey(entity => entity.AnswerAttemptId);
        builder.HasIndex(entity => entity.ClientAttemptId).IsUnique();
        builder.HasIndex(entity => new { entity.YoutubeVideoId, entity.GradedAtUtc });
        builder.Property(entity => entity.ClientAttemptId).HasMaxLength(128).IsRequired();
        builder.Property(entity => entity.QuizId).HasMaxLength(64).IsRequired();
        builder.Property(entity => entity.SessionId).HasMaxLength(64).IsRequired();
        builder.Property(entity => entity.QuestionId).HasMaxLength(64).IsRequired();
        builder.Property(entity => entity.YoutubeVideoId).HasMaxLength(32).IsRequired();
        builder.Property(entity => entity.QuestionType).HasMaxLength(32).IsRequired();
        builder.Property(entity => entity.Outcome).HasMaxLength(32).IsRequired();
    }
}
