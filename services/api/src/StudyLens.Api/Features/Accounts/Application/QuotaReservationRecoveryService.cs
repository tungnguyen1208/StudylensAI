using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.Accounts.Infrastructure;
using StudyLens.Api.Features.AssessmentHistory.Infrastructure;
using StudyLens.Api.Features.SessionQuiz.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;

namespace StudyLens.Api.Features.Accounts.Application;

public sealed class QuotaReservationRecoveryService(IServiceScopeFactory scopeFactory, ILogger<QuotaReservationRecoveryService> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<StudyLensDbContext>();
        var quota = scope.ServiceProvider.GetRequiredService<QuotaService>();
        var now = DateTimeOffset.UtcNow;
        var reservations = await db.Set<QuotaReservationEntity>().AsNoTracking()
            .Where(item => item.Status == "reserved").ToArrayAsync(stoppingToken);
        foreach (var reservation in reservations)
        {
            var transition = await ResolveTransitionAsync(db, reservation, now, stoppingToken);
            if (transition == "consume") await quota.ConsumeAsync(reservation.QuotaReservationId, stoppingToken);
            if (transition == "release") await quota.ReleaseAsync(reservation.QuotaReservationId, stoppingToken);
        }
        if (reservations.Length > 0)
            logger.LogInformation("Reconciled {ReservationCount} persisted quota reservations after Backend restart.", reservations.Length);
    }

    private static async Task<string?> ResolveTransitionAsync(StudyLensDbContext db, QuotaReservationEntity reservation,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (reservation.ResourceType == QuotaService.ShortAnswerGrade)
        {
            var clientAttemptId = reservation.OperationKey.StartsWith("attempt:", StringComparison.Ordinal)
                ? reservation.OperationKey["attempt:".Length..]
                : reservation.OperationKey.StartsWith("answer:", StringComparison.Ordinal)
                    ? reservation.OperationKey["answer:".Length..] : null;
            if (clientAttemptId is not null && (await db.Set<QuizAttemptEntity>().AsNoTracking().AnyAsync(item =>
                    item.UserId == reservation.UserId && item.ClientAttemptId == clientAttemptId, cancellationToken) ||
                await db.Set<AnswerAttemptEntity>().AsNoTracking().AnyAsync(item =>
                    item.UserId == reservation.UserId && item.ClientAttemptId == clientAttemptId, cancellationToken))) return "consume";
            return reservation.UpdatedAtUtc < now.AddMinutes(-15) ? "release" : null;
        }

        var job = await db.Set<ProcessingJobEntity>().AsNoTracking()
            .Where(item => item.QuotaReservationId == reservation.QuotaReservationId)
            .OrderByDescending(item => item.UpdatedAtUtc).FirstOrDefaultAsync(cancellationToken);
        if (job?.Status == "succeeded") return "consume";
        if (job?.Status is "failed" or "cancelled") return "release";
        if (job?.Status is "queued" or "running") return null;
        if (reservation.ResourceType == QuotaService.QuizGenerate)
        {
            var session = await db.Set<StudySessionEntity>().AsNoTracking().SingleOrDefaultAsync(item =>
                item.UserId == reservation.UserId && item.QuizQuotaReservationId == reservation.QuotaReservationId, cancellationToken);
            if (session?.QuizStatus == "ready") return "consume";
            if (session?.Status == "active") return null;
        }
        return "release";
    }
}
