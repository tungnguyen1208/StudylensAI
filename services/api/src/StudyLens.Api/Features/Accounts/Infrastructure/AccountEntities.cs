using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace StudyLens.Api.Features.Accounts.Infrastructure;

public sealed class AppUserEntity
{
    public string UserId { get; set; } = string.Empty;
    public string? GoogleSubject { get; set; }
    public string? Email { get; set; }
    public string DisplayName { get; set; } = string.Empty;
    public string? PictureUrl { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset LastLoginAtUtc { get; set; }
}

public sealed class LocalCredentialEntity
{
    public string UserId { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string NormalizedUsername { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public int FailedAccessAttempts { get; set; }
    public DateTimeOffset? LockoutEndUtc { get; set; }
    public DateTimeOffset PasswordChangedAtUtc { get; set; }
}

public sealed class AuthTokenEntity
{
    public string TokenHash { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public string TokenType { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset ExpiresAtUtc { get; set; }
    public DateTimeOffset? RevokedAtUtc { get; set; }
}

public sealed class DailyQuotaEntity
{
    public string UserId { get; set; } = string.Empty;
    public DateOnly QuotaDateUtc { get; set; }
    public string ResourceType { get; set; } = string.Empty;
    public int Used { get; set; }
    public int Reserved { get; set; }
}

public sealed class QuotaReservationEntity
{
    public string QuotaReservationId { get; set; } = string.Empty;
    public string UserId { get; set; } = string.Empty;
    public DateOnly QuotaDateUtc { get; set; }
    public string ResourceType { get; set; } = string.Empty;
    public string OperationKey { get; set; } = string.Empty;
    public int Units { get; set; }
    public string Status { get; set; } = "reserved";
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

internal sealed class AppUserEntityConfiguration : IEntityTypeConfiguration<AppUserEntity>
{
    public void Configure(EntityTypeBuilder<AppUserEntity> builder)
    {
        builder.ToTable("AppUsers");
        builder.HasKey(item => item.UserId);
        builder.Property(item => item.UserId).HasMaxLength(64);
        builder.Property(item => item.GoogleSubject).HasMaxLength(128);
        builder.Property(item => item.Email).HasMaxLength(320);
        builder.Property(item => item.DisplayName).HasMaxLength(200).IsRequired();
        builder.Property(item => item.PictureUrl).HasMaxLength(2048);
        builder.HasIndex(item => item.GoogleSubject).IsUnique();
    }
}

internal sealed class LocalCredentialEntityConfiguration : IEntityTypeConfiguration<LocalCredentialEntity>
{
    public void Configure(EntityTypeBuilder<LocalCredentialEntity> builder)
    {
        builder.ToTable("LocalCredentials");
        builder.HasKey(item => item.UserId);
        builder.Property(item => item.UserId).HasMaxLength(64);
        builder.Property(item => item.Username).HasMaxLength(32).IsRequired();
        builder.Property(item => item.NormalizedUsername).HasMaxLength(32).IsRequired();
        builder.Property(item => item.PasswordHash).HasMaxLength(512).IsRequired();
        builder.HasIndex(item => item.NormalizedUsername).IsUnique();
        builder.HasOne<AppUserEntity>().WithOne().HasForeignKey<LocalCredentialEntity>(item => item.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class AuthTokenEntityConfiguration : IEntityTypeConfiguration<AuthTokenEntity>
{
    public void Configure(EntityTypeBuilder<AuthTokenEntity> builder)
    {
        builder.ToTable("AuthTokens");
        builder.HasKey(item => item.TokenHash);
        builder.Property(item => item.TokenHash).HasMaxLength(64);
        builder.Property(item => item.UserId).HasMaxLength(64).IsRequired();
        builder.Property(item => item.TokenType).HasMaxLength(16).IsRequired();
        builder.Property(item => item.RevokedAtUtc).IsConcurrencyToken();
        builder.HasIndex(item => new { item.UserId, item.TokenType });
        builder.HasOne<AppUserEntity>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class DailyQuotaEntityConfiguration : IEntityTypeConfiguration<DailyQuotaEntity>
{
    public void Configure(EntityTypeBuilder<DailyQuotaEntity> builder)
    {
        builder.ToTable("DailyQuotas");
        builder.HasKey(item => new { item.UserId, item.QuotaDateUtc, item.ResourceType });
        builder.Property(item => item.UserId).HasMaxLength(64);
        builder.Property(item => item.ResourceType).HasMaxLength(32);
        builder.HasOne<AppUserEntity>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class QuotaReservationEntityConfiguration : IEntityTypeConfiguration<QuotaReservationEntity>
{
    public void Configure(EntityTypeBuilder<QuotaReservationEntity> builder)
    {
        builder.ToTable("QuotaReservations");
        builder.HasKey(item => item.QuotaReservationId);
        builder.Property(item => item.QuotaReservationId).HasMaxLength(64);
        builder.Property(item => item.UserId).HasMaxLength(64).IsRequired();
        builder.Property(item => item.ResourceType).HasMaxLength(32).IsRequired();
        builder.Property(item => item.OperationKey).HasMaxLength(200).IsRequired();
        builder.Property(item => item.Status).HasMaxLength(16).IsRequired();
        builder.HasIndex(item => new { item.UserId, item.QuotaDateUtc, item.ResourceType, item.OperationKey }).IsUnique();
        builder.HasOne<AppUserEntity>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
