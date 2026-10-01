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
    public string Status { get; set; } = "ready";
    public string QuestionType { get; set; } = "multipleChoice";
    public string Difficulty { get; set; } = "medium";
    public string? TranscriptCaptureId { get; set; }
    public string PromptVersion { get; set; } = "0.5.0";
    public string? ModelName { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public List<QuestionAssessmentEntity> Questions { get; set; } = [];
}

public sealed class QuestionAssessmentEntity
{
    public string QuestionId { get; set; } = string.Empty;
    public string QuizId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public int Position { get; set; }
    public string Prompt { get; set; } = string.Empty;
    public string? CorrectOptionId { get; set; }
    public string? ReferenceAnswer { get; set; }
    public string Explanation { get; set; } = string.Empty;
    public string YoutubeVideoId { get; set; } = string.Empty;
    public long SourceStartMs { get; set; }
    public long SourceEndMs { get; set; }
    public string? OptionsJson { get; set; }
    public QuizAssessmentEntity? Quiz { get; set; }
    public List<QuestionOptionEntity> Options { get; set; } = [];
}

public sealed class QuestionOptionEntity
{
    public string QuestionOptionId { get; set; } = string.Empty;
    public string QuestionId { get; set; } = string.Empty;
    public string OptionId { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public int Position { get; set; }
    public QuestionAssessmentEntity? Question { get; set; }
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
        builder.HasIndex(entity => entity.YoutubeVideoId);
        builder.Property(entity => entity.Status).HasMaxLength(16).IsRequired();
        builder.Property(entity => entity.QuestionType).HasMaxLength(32).IsRequired();
        builder.Property(entity => entity.Difficulty).HasMaxLength(16).IsRequired();
        builder.Property(entity => entity.TranscriptCaptureId).HasMaxLength(64);
        builder.Property(entity => entity.PromptVersion).HasMaxLength(16).IsRequired();
        builder.Property(entity => entity.ModelName).HasMaxLength(128);
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
        builder.Property(entity => entity.Position).IsRequired();
        builder.Property(entity => entity.Prompt).IsRequired();
        builder.Property(entity => entity.YoutubeVideoId).HasMaxLength(32).IsRequired();
        builder.Property(entity => entity.Explanation).IsRequired();
        builder.HasIndex(entity => new { entity.QuizId, entity.Position });
        builder.HasMany(entity => entity.Options).WithOne(entity => entity.Question!).HasForeignKey(entity => entity.QuestionId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class QuestionOptionEntityConfiguration : IEntityTypeConfiguration<QuestionOptionEntity>
{
    public void Configure(EntityTypeBuilder<QuestionOptionEntity> builder)
    {
        builder.ToTable("QuestionOptions");
        builder.HasKey(entity => entity.QuestionOptionId);
        builder.Property(entity => entity.QuestionOptionId).HasMaxLength(64);
        builder.Property(entity => entity.QuestionId).HasMaxLength(64).IsRequired();
        builder.Property(entity => entity.OptionId).HasMaxLength(64).IsRequired();
        builder.Property(entity => entity.Text).IsRequired();
        builder.HasIndex(entity => new { entity.QuestionId, entity.OptionId }).IsUnique();
    }
}

public sealed class SqliteQuestionAssessmentStore(StudyLensDbContext db) : IQuestionAssessmentStore
{
    public async Task<QuizAssessmentRecord?> FindByIdempotencyKeyAsync(string idempotencyKey, CancellationToken cancellationToken)
    {
        var entity = await db.Set<QuizAssessmentEntity>().AsNoTracking().Include(item => item.Questions).ThenInclude(item => item.Options)
            .SingleOrDefaultAsync(item => item.IdempotencyKey == idempotencyKey, cancellationToken);
        return entity is null ? null : ToRecord(entity);
    }

    public async Task<QuestionForAssessment?> FindAsync(string quizId, string questionId, CancellationToken cancellationToken)
    {
        var entity = await db.Set<QuestionAssessmentEntity>().AsNoTracking().Include(item => item.Quiz).Include(item => item.Options)
            .SingleOrDefaultAsync(item => item.QuizId == quizId && item.QuestionId == questionId, cancellationToken);
        return entity is null ? null : ToQuestion(entity, entity.Quiz?.SessionId ?? string.Empty);
    }

    public async Task<QuizPublicModel?> FindQuizAsync(string quizId, CancellationToken cancellationToken)
    {
        var entity = await db.Set<QuizAssessmentEntity>().AsNoTracking().Include(item => item.Questions).ThenInclude(item => item.Options)
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
            Questions = record.Questions.Select((question, position) => new QuestionAssessmentEntity
            {
                QuestionId = question.QuestionId,
                QuizId = question.QuizId,
                Type = question.Type,
                Position = position,
                Prompt = question.Prompt,
                CorrectOptionId = question.CorrectOptionId,
                OptionsJson = question.Options is null ? null : JsonSerializer.Serialize(question.Options),
                ReferenceAnswer = question.ReferenceAnswer,
                Explanation = string.Empty,
                YoutubeVideoId = question.YoutubeVideoId,
                SourceStartMs = question.SourceStartMs,
                SourceEndMs = question.SourceEndMs,
                Options = question.Options?.Select((option, index) => new QuestionOptionEntity
                {
                    QuestionOptionId = Guid.NewGuid().ToString(),
                    QuestionId = question.QuestionId,
                    OptionId = option.OptionId,
                    Text = option.Text,
                    Position = index,
                }).ToList() ?? [],
            }).ToList(),
        };
        db.Set<QuizAssessmentEntity>().Add(entity);
        await db.SaveChangesAsync(cancellationToken);
    }

    private static QuizAssessmentRecord ToRecord(QuizAssessmentEntity entity) => new(
        entity.IdempotencyKey,
        new QuizPublicModel(entity.QuizId, entity.SessionId, entity.SegmentId, "available", entity.Questions.OrderBy(question => question.Position).Select(question =>
            new QuestionPublicModel(question.QuestionId, question.Type, question.Prompt,
                ReadOptions(question),
                new QuestionSourceRef(question.YoutubeVideoId, question.SourceStartMs, question.SourceEndMs))).ToArray(), entity.CreatedAtUtc),
        entity.Questions.Select(question => ToQuestion(question, entity.SessionId)).ToArray());

    private static QuestionForAssessment ToQuestion(QuestionAssessmentEntity entity, string sessionId) => new(
        entity.QuizId, sessionId, entity.QuestionId, entity.Type, entity.Prompt, entity.CorrectOptionId,
        ReadOptions(entity),
        entity.ReferenceAnswer, entity.YoutubeVideoId, entity.SourceStartMs, entity.SourceEndMs);

    private static QuestionOptionPublicModel[]? ReadOptions(QuestionAssessmentEntity entity) => entity.Options.Count > 0
        ? entity.Options.OrderBy(item => item.Position).Select(item => new QuestionOptionPublicModel(item.OptionId, item.Text)).ToArray()
        : string.IsNullOrWhiteSpace(entity.OptionsJson) ? null : JsonSerializer.Deserialize<QuestionOptionPublicModel[]>(entity.OptionsJson);
}
