using System.Collections.Concurrent;
using System.Data;
using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.Accounts.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;

namespace StudyLens.Api.Features.Accounts.Application;

public sealed class QuotaService(StudyLensDbContext db, TimeProvider clock)
{
    public const string QuizGenerate = "quizGenerate";
    public const string TranscriptGenerate = "transcriptGenerate";
    public const string ShortAnswerGrade = "shortAnswerGrade";

    private static readonly IReadOnlyDictionary<string, int> Limits = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        [QuizGenerate] = 5,
        [TranscriptGenerate] = 2,
        [ShortAnswerGrade] = 20,
    };
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new(StringComparer.Ordinal);

    public async Task<QuotaDecision> ReserveAsync(string userId, string resourceType, string operationKey, int units,
        CancellationToken cancellationToken)
    {
        if (!Limits.TryGetValue(resourceType, out var limit) || units <= 0 || string.IsNullOrWhiteSpace(operationKey))
            throw new ArgumentException("A supported quota resource, operation key and positive unit count are required.");

        var now = clock.GetUtcNow();
        var date = DateOnly.FromDateTime(now.UtcDateTime);
        var gate = Locks.GetOrAdd($"{userId}:{date:O}:{resourceType}", _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            // Npgsql's retrying execution strategy requires a user-initiated
            // transaction to be executed as one retriable unit. SQLite tests
            // use the same path through its non-retrying strategy.
            var strategy = db.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
                var existing = await db.Set<QuotaReservationEntity>().SingleOrDefaultAsync(item =>
                    item.UserId == userId && item.QuotaDateUtc == date && item.ResourceType == resourceType &&
                    item.OperationKey == operationKey, cancellationToken);
                if (existing is not null)
                {
                    var existingCounter = await CounterAsync(userId, resourceType, date, limit, now, cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                    return existing.Status is "reserved" or "consumed"
                        ? QuotaDecision.Granted(existing.QuotaReservationId, existingCounter)
                        : QuotaDecision.Denied(existingCounter);
                }

                var counter = await db.Set<DailyQuotaEntity>().SingleOrDefaultAsync(item =>
                    item.UserId == userId && item.QuotaDateUtc == date && item.ResourceType == resourceType, cancellationToken);
                if (counter is null)
                {
                    counter = new DailyQuotaEntity { UserId = userId, QuotaDateUtc = date, ResourceType = resourceType };
                    db.Add(counter);
                }

                if (counter.Used + counter.Reserved + units > limit)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return QuotaDecision.Denied(ToView(counter, limit, now));
                }

                counter.Reserved += units;
                var reservation = new QuotaReservationEntity
                {
                    QuotaReservationId = Guid.NewGuid().ToString(),
                    UserId = userId,
                    QuotaDateUtc = date,
                    ResourceType = resourceType,
                    OperationKey = operationKey,
                    Units = units,
                    Status = "reserved",
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now,
                };
                db.Add(reservation);
                await db.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return QuotaDecision.Granted(reservation.QuotaReservationId, ToView(counter, limit, now));
            });
        }
        finally
        {
            gate.Release();
        }
    }

    public Task ConsumeAsync(string? reservationId, CancellationToken cancellationToken) =>
        TransitionAsync(reservationId, "consumed", cancellationToken);

    public Task ReleaseAsync(string? reservationId, CancellationToken cancellationToken) =>
        TransitionAsync(reservationId, "released", cancellationToken);

    public async Task<AccountQuotaView> ReadAsync(string userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var date = DateOnly.FromDateTime(now.UtcDateTime);
        var rows = await db.Set<DailyQuotaEntity>().AsNoTracking()
            .Where(item => item.UserId == userId && item.QuotaDateUtc == date)
            .ToDictionaryAsync(item => item.ResourceType, StringComparer.Ordinal, cancellationToken);
        return new AccountQuotaView("0.7.0", Limits.Select(item => rows.TryGetValue(item.Key, out var row)
            ? ToView(row, item.Value, now)
            : new QuotaCounterView(item.Key, item.Value, 0, 0, item.Value, ResetAt(now))).ToArray());
    }

    private async Task TransitionAsync(string? reservationId, string target, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(reservationId)) return;
        var reservation = await db.Set<QuotaReservationEntity>()
            .SingleOrDefaultAsync(item => item.QuotaReservationId == reservationId, cancellationToken);
        if (reservation is null || reservation.Status != "reserved") return;

        var gate = Locks.GetOrAdd($"{reservation.UserId}:{reservation.QuotaDateUtc:O}:{reservation.ResourceType}", _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            reservation = await db.Set<QuotaReservationEntity>()
                .SingleOrDefaultAsync(item => item.QuotaReservationId == reservationId, cancellationToken);
            if (reservation is null || reservation.Status != "reserved") return;
            var counter = await db.Set<DailyQuotaEntity>().SingleAsync(item => item.UserId == reservation.UserId &&
                item.QuotaDateUtc == reservation.QuotaDateUtc && item.ResourceType == reservation.ResourceType, cancellationToken);
            counter.Reserved = Math.Max(0, counter.Reserved - reservation.Units);
            if (target == "consumed") counter.Used += reservation.Units;
            reservation.Status = target;
            reservation.UpdatedAtUtc = clock.GetUtcNow();
            await db.SaveChangesAsync(cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<QuotaCounterView> CounterAsync(string userId, string resourceType, DateOnly date, int limit,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var row = await db.Set<DailyQuotaEntity>().AsNoTracking().SingleOrDefaultAsync(item => item.UserId == userId &&
            item.QuotaDateUtc == date && item.ResourceType == resourceType, cancellationToken);
        return row is null
            ? new QuotaCounterView(resourceType, limit, 0, 0, limit, ResetAt(now))
            : ToView(row, limit, now);
    }

    private static QuotaCounterView ToView(DailyQuotaEntity row, int limit, DateTimeOffset now) => new(
        row.ResourceType, limit, row.Used, row.Reserved, Math.Max(0, limit - row.Used - row.Reserved), ResetAt(now));

    private static DateTimeOffset ResetAt(DateTimeOffset now) =>
        new(now.UtcDateTime.Date.AddDays(1), TimeSpan.Zero);
}
