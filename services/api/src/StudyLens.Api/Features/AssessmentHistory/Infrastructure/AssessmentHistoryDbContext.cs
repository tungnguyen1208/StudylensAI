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

public sealed class QuizAttemptEntity
{
    public string QuizAttemptId { get; set; } = string.Empty;
    public string ClientAttemptId { get; set; } = string.Empty;
    public string QuizId { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public double Score { get; set; }
    public DateTimeOffset SubmittedAtUtc { get; set; }
    public List<AttemptAnswerEntity> Answers { get; set; } = [];
}

public sealed class AttemptAnswerEntity
{
    public string AttemptAnswerId { get; set; } = string.Empty;
    public string QuizAttemptId { get; set; } = string.Empty;
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
    public QuizAttemptEntity? QuizAttempt { get; set; }
}

public sealed class AssessmentHistoryDbContext(StudyLensDbContext db)
{
    public StudyLensDbContext RootDb => db;
    public DbSet<AnswerAttemptEntity> AnswerAttempts => db.Set<AnswerAttemptEntity>();
    public DbSet<QuizAttemptEntity> QuizAttempts => db.Set<QuizAttemptEntity>();
    public DbSet<AttemptAnswerEntity> AttemptAnswers => db.Set<AttemptAnswerEntity>();
    public Task<int> SaveChangesAsync(CancellationToken cancellationToken) => db.SaveChangesAsync(cancellationToken);
    public void Detach(AnswerAttemptEntity entity) => db.Entry(entity).State = EntityState.Detached;
}

public sealed class QuizAttemptEntityConfiguration : IEntityTypeConfiguration<QuizAttemptEntity>
{
    public void Configure(EntityTypeBuilder<QuizAttemptEntity> builder)
    {
        builder.ToTable("QuizAttempts");
        builder.HasKey(entity => entity.QuizAttemptId);
        builder.Property(entity => entity.ClientAttemptId).HasMaxLength(128).IsRequired();
        builder.Property(entity => entity.QuizId).HasMaxLength(64).IsRequired();
        builder.Property(entity => entity.SessionId).HasMaxLength(64).IsRequired();
        builder.HasIndex(entity => entity.ClientAttemptId).IsUnique();
        builder.HasMany(entity => entity.Answers).WithOne(entity => entity.QuizAttempt!).HasForeignKey(entity => entity.QuizAttemptId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class AttemptAnswerEntityConfiguration : IEntityTypeConfiguration<AttemptAnswerEntity>
{
    public void Configure(EntityTypeBuilder<AttemptAnswerEntity> builder)
    {
        builder.ToTable("AttemptAnswers");
        builder.HasKey(entity => entity.AttemptAnswerId);
        builder.Property(entity => entity.QuizAttemptId).HasMaxLength(64).IsRequired();
        builder.Property(entity => entity.QuestionId).HasMaxLength(64).IsRequired();
        builder.Property(entity => entity.YoutubeVideoId).HasMaxLength(32).IsRequired();
        builder.Property(entity => entity.QuestionType).HasMaxLength(32).IsRequired();
        builder.Property(entity => entity.Outcome).HasMaxLength(32).IsRequired();
        builder.HasIndex(entity => new { entity.QuizAttemptId, entity.QuestionId }).IsUnique();
    }
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
