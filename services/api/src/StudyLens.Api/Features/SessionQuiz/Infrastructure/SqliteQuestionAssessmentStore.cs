using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using System.Text.Json;
using StudyLens.Api.Features.SessionQuiz.Application;
using StudyLens.Api.Features.SessionQuiz.Application.Abstractions;
using StudyLens.Api.Infrastructure.Persistence;

namespace StudyLens.Api.Features.SessionQuiz.Infrastructure;

public sealed class QuizAssessmentEntity
{
    public string QuizId { get; set; } = string.Empty;
    public string IdempotencyKey { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public string SegmentId { get; set; } = string.Empty;
    public string YoutubeVideoId { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public List<QuestionAssessmentEntity> Questions { get; set; } = [];
}

public sealed class QuestionAssessmentEntity
{
    public string QuestionId { get; set; } = string.Empty;
    public string QuizId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public string? CorrectOptionId { get; set; }
    public string? ReferenceAnswer { get; set; }
    public string YoutubeVideoId { get; set; } = string.Empty;
    public long SourceStartMs { get; set; }
    public long SourceEndMs { get; set; }
    public string? OptionsJson { get; set; }
    public QuizAssessmentEntity? Quiz { get; set; }
}

public sealed class QuizAssessmentEntityConfiguration : IEntityTypeConfiguration<QuizAssessmentEntity>
{
    public void Configure(EntityTypeBuilder<QuizAssessmentEntity> builder)
    {
        builder.ToTable("QuizAssessments");
        builder.HasKey(entity => entity.QuizId);
        builder.HasIndex(entity => entity.IdempotencyKey).IsUnique();
        builder.Property(entity => entity.IdempotencyKey).HasMaxLength(200).IsRequired();
        builder.Property(entity => entity.SessionId).HasMaxLength(64).IsRequired();
        builder.Property(entity => entity.SegmentId).HasMaxLength(64).IsRequired();
        builder.Property(entity => entity.YoutubeVideoId).HasMaxLength(32).IsRequired();
        builder.HasMany(entity => entity.Questions).WithOne(entity => entity.Quiz!).HasForeignKey(entity => entity.QuizId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class QuestionAssessmentEntityConfiguration : IEntityTypeConfiguration<QuestionAssessmentEntity>
{
    public void Configure(EntityTypeBuilder<QuestionAssessmentEntity> builder)
    {
        builder.ToTable("QuestionAssessments");
        builder.HasKey(entity => entity.QuestionId);
        builder.Property(entity => entity.Type).HasMaxLength(32).IsRequired();
        builder.Property(entity => entity.Prompt).IsRequired();
        builder.Property(entity => entity.YoutubeVideoId).HasMaxLength(32).IsRequired();
    }
}

public sealed class SqliteQuestionAssessmentStore(StudyLensDbContext db) : IQuestionAssessmentStore
{
    public async Task<QuizAssessmentRecord?> FindByIdempotencyKeyAsync(string idempotencyKey, CancellationToken cancellationToken)
    {
        var entity = await db.Set<QuizAssessmentEntity>().AsNoTracking().Include(item => item.Questions)
            .SingleOrDefaultAsync(item => item.IdempotencyKey == idempotencyKey, cancellationToken);
        return entity is null ? null : ToRecord(entity);
    }

    public async Task<QuestionForAssessment?> FindAsync(string quizId, string questionId, CancellationToken cancellationToken)
    {
        var entity = await db.Set<QuestionAssessmentEntity>().AsNoTracking().Include(item => item.Quiz)
            .SingleOrDefaultAsync(item => item.QuizId == quizId && item.QuestionId == questionId, cancellationToken);
        return entity is null ? null : ToQuestion(entity, entity.Quiz?.SessionId ?? string.Empty);
    }

    public async Task<QuizPublicModel?> FindQuizAsync(string quizId, CancellationToken cancellationToken)
    {
        var entity = await db.Set<QuizAssessmentEntity>().AsNoTracking().Include(item => item.Questions)
            .SingleOrDefaultAsync(item => item.QuizId == quizId, cancellationToken);
        return entity is null ? null : ToRecord(entity).Quiz;
    }

    public async Task SaveAsync(QuizAssessmentRecord record, CancellationToken cancellationToken)
    {
        if (await db.Set<QuizAssessmentEntity>().AnyAsync(item => item.IdempotencyKey == record.IdempotencyKey, cancellationToken)) return;
        var entity = new QuizAssessmentEntity
        {
            QuizId = record.Quiz.QuizId,
            IdempotencyKey = record.IdempotencyKey,
            SessionId = record.Quiz.SessionId,
            SegmentId = record.Quiz.SegmentId,
            YoutubeVideoId = record.Questions.FirstOrDefault()?.YoutubeVideoId ?? string.Empty,
            CreatedAtUtc = record.Quiz.CreatedAtUtc,
            Questions = record.Questions.Select(question => new QuestionAssessmentEntity
            {
                QuestionId = question.QuestionId,
                QuizId = question.QuizId,
                Type = question.Type,
                Prompt = question.Prompt,
                CorrectOptionId = question.CorrectOptionId,
                OptionsJson = question.Options is null ? null : JsonSerializer.Serialize(question.Options),
                ReferenceAnswer = question.ReferenceAnswer,
                YoutubeVideoId = question.YoutubeVideoId,
                SourceStartMs = question.SourceStartMs,
                SourceEndMs = question.SourceEndMs,
            }).ToList(),
        };
        db.Set<QuizAssessmentEntity>().Add(entity);
        await db.SaveChangesAsync(cancellationToken);
    }

    private static QuizAssessmentRecord ToRecord(QuizAssessmentEntity entity) => new(
        entity.IdempotencyKey,
        new QuizPublicModel(entity.QuizId, entity.SessionId, entity.SegmentId, "available", entity.Questions.Select(question =>
            new QuestionPublicModel(question.QuestionId, question.Type, question.Prompt,
                string.IsNullOrWhiteSpace(question.OptionsJson) ? null : JsonSerializer.Deserialize<QuestionOptionPublicModel[]>(question.OptionsJson),
                new QuestionSourceRef(question.YoutubeVideoId, question.SourceStartMs, question.SourceEndMs))).ToArray(), entity.CreatedAtUtc),
        entity.Questions.Select(question => ToQuestion(question, entity.SessionId)).ToArray());

    private static QuestionForAssessment ToQuestion(QuestionAssessmentEntity entity, string sessionId) => new(
        entity.QuizId, sessionId, entity.QuestionId, entity.Type, entity.Prompt, entity.CorrectOptionId,
        string.IsNullOrWhiteSpace(entity.OptionsJson) ? null : JsonSerializer.Deserialize<QuestionOptionPublicModel[]>(entity.OptionsJson),
        entity.ReferenceAnswer, entity.YoutubeVideoId, entity.SourceStartMs, entity.SourceEndMs);
}
