using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace StudyLens.Api.Features.VideoActivation.Infrastructure;

internal sealed class TranscriptCaptureEntity
{
    public string TranscriptCaptureId { get; set; } = string.Empty;
    public string YoutubeVideoId { get; set; } = string.Empty;
    public string Language { get; set; } = "und";
    // Existing rows and the audio-chunk table are retained as legacy data.
    // New captures are immutable YouTube caption cue sets.
    public string Source { get; set; } = "youtubeCaption";
    public string Status { get; set; } = "unavailable";
    public int Version { get; set; }
    public string CreateIdempotencyKey { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public List<TranscriptCaptureCueEntity> Cues { get; set; } = [];
    public List<TranscriptAudioChunkEntity> Chunks { get; set; } = [];
}

internal sealed class TranscriptCaptureCueEntity
{
    public string TranscriptCueId { get; set; } = string.Empty;
    public string TranscriptCaptureId { get; set; } = string.Empty;
    public int ChunkIndex { get; set; }
    public long StartMs { get; set; }
    public long EndMs { get; set; }
    public string Text { get; set; } = string.Empty;
}

internal sealed class TranscriptAudioChunkEntity
{
    public string TranscriptAudioChunkId { get; set; } = string.Empty;
    public string TranscriptCaptureId { get; set; } = string.Empty;
    public string IdempotencyKey { get; set; } = string.Empty;
    public string PayloadFingerprint { get; set; } = string.Empty;
    public int ChunkIndex { get; set; }
    public long StartMs { get; set; }
    public long EndMs { get; set; }
    public DateTimeOffset AcceptedAtUtc { get; set; }
}

internal sealed class TranscriptCaptureEntityConfiguration : IEntityTypeConfiguration<TranscriptCaptureEntity>
{
    public void Configure(EntityTypeBuilder<TranscriptCaptureEntity> builder)
    {
        builder.ToTable("TranscriptCaptures");
        builder.HasKey(item => item.TranscriptCaptureId);
        builder.Property(item => item.TranscriptCaptureId).HasMaxLength(64);
        builder.Property(item => item.YoutubeVideoId).HasMaxLength(32).IsRequired();
        builder.Property(item => item.Language).HasMaxLength(16).IsRequired();
        builder.Property(item => item.Source).HasMaxLength(32).IsRequired();
        builder.Property(item => item.Status).HasMaxLength(16).IsRequired();
        builder.Property(item => item.CreateIdempotencyKey).HasMaxLength(200).IsRequired();
        builder.HasIndex(item => item.CreateIdempotencyKey).IsUnique();
        builder.HasMany(item => item.Cues).WithOne().HasForeignKey(item => item.TranscriptCaptureId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(item => item.Chunks).WithOne().HasForeignKey(item => item.TranscriptCaptureId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class TranscriptCaptureCueEntityConfiguration : IEntityTypeConfiguration<TranscriptCaptureCueEntity>
{
    public void Configure(EntityTypeBuilder<TranscriptCaptureCueEntity> builder)
    {
        builder.ToTable("TranscriptCaptureCues");
        builder.HasKey(item => item.TranscriptCueId);
        builder.Property(item => item.Text).IsRequired();
        builder.HasIndex(item => new { item.TranscriptCaptureId, item.ChunkIndex });
    }
}

internal sealed class TranscriptAudioChunkEntityConfiguration : IEntityTypeConfiguration<TranscriptAudioChunkEntity>
{
    public void Configure(EntityTypeBuilder<TranscriptAudioChunkEntity> builder)
    {
        builder.ToTable("TranscriptAudioChunks");
        builder.HasKey(item => item.TranscriptAudioChunkId);
        builder.Property(item => item.IdempotencyKey).HasMaxLength(200).IsRequired();
        builder.Property(item => item.PayloadFingerprint).HasMaxLength(64).IsRequired();
        builder.HasIndex(item => item.IdempotencyKey).IsUnique();
        builder.HasIndex(item => new { item.TranscriptCaptureId, item.ChunkIndex }).IsUnique();
    }
}
