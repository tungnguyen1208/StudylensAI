using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.Accounts.Application;
using StudyLens.Api.Features.Accounts.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;
using Xunit;

namespace SessionQuiz.Tests;

public sealed class AccountQuotaTests
{
    [Fact]
    public async Task QuizQuota_ReservesFive_RejectsSixth_AndOnlyConsumesOnSuccess()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        await SeedUserAsync(db, "user-a");
        var service = new QuotaService(db, TimeProvider.System);
        var reservations = new List<string>();

        for (var index = 0; index < 5; index++)
        {
            var decision = await service.ReserveAsync("user-a", QuotaService.QuizGenerate, $"quiz-{index}", 1, CancellationToken.None);
            Assert.True(decision.Allowed);
            reservations.Add(decision.ReservationId!);
        }
        var denied = await service.ReserveAsync("user-a", QuotaService.QuizGenerate, "quiz-6", 1, CancellationToken.None);
        Assert.False(denied.Allowed);
        Assert.Equal(0, denied.Counter.Remaining);

        await service.ConsumeAsync(reservations[0], CancellationToken.None);
        await service.ReleaseAsync(reservations[1], CancellationToken.None);
        var quota = await service.ReadAsync("user-a", CancellationToken.None);
        var quiz = Assert.Single(quota.Items, item => item.ResourceType == QuotaService.QuizGenerate);
        Assert.Equal(1, quiz.Used);
        Assert.Equal(3, quiz.Reserved);
        Assert.Equal(1, quiz.Remaining);
    }

    [Fact]
    public async Task ConcurrentReservations_CannotExceedDailyTranscriptLimit()
    {
        var path = Path.Combine(Path.GetTempPath(), $"studylens-quota-{Guid.NewGuid():N}.db");
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite($"Data Source={path};Pooling=False").Options;
        try
        {
            await using (var setup = new StudyLensDbContext(options))
            {
                await setup.Database.EnsureCreatedAsync();
                await SeedUserAsync(setup, "user-a");
            }
            var tasks = Enumerable.Range(0, 3).Select(async index =>
            {
                await using var db = new StudyLensDbContext(options);
                return await new QuotaService(db, TimeProvider.System).ReserveAsync("user-a", QuotaService.TranscriptGenerate,
                    $"transcript-{index}", 1, CancellationToken.None);
            });
            var decisions = await Task.WhenAll(tasks);
            Assert.Equal(2, decisions.Count(item => item.Allowed));
            Assert.Single(decisions, item => !item.Allowed);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public async Task ReleasedReservation_CanBeReservedAgainOnNextUtcDay()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
        await using var db = new StudyLensDbContext(options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        await SeedUserAsync(db, "user-a");
        var clock = new MutableTimeProvider(new DateTimeOffset(2026, 10, 15, 23, 59, 0, TimeSpan.Zero));
        var service = new QuotaService(db, clock);

        var first = await service.ReserveAsync("user-a", QuotaService.QuizGenerate, "same-operation", 1, CancellationToken.None);
        await service.ReleaseAsync(first.ReservationId, CancellationToken.None);
        clock.UtcNow = clock.UtcNow.AddMinutes(2);
        var nextDay = await service.ReserveAsync("user-a", QuotaService.QuizGenerate, "same-operation", 1, CancellationToken.None);

        Assert.True(nextDay.Allowed);
        Assert.NotEqual(first.ReservationId, nextDay.ReservationId);
        Assert.Equal(2, await db.Set<QuotaReservationEntity>().CountAsync());
        Assert.Equal(1, nextDay.Counter.Reserved);
        Assert.Equal(4, nextDay.Counter.Remaining);
    }

    private static async Task SeedUserAsync(StudyLensDbContext db, string userId)
    {
        db.Add(new AppUserEntity
        {
            UserId = userId,
            GoogleSubject = $"google-{userId}",
            Email = $"{userId}@example.test",
            DisplayName = userId,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            LastLoginAtUtc = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    private sealed class MutableTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public DateTimeOffset UtcNow { get; set; } = utcNow;
        public override DateTimeOffset GetUtcNow() => UtcNow;
    }
}
