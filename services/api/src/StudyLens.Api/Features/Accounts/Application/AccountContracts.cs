using System.Security.Claims;

namespace StudyLens.Api.Features.Accounts.Application;

public static class AccountClaims
{
    public static string UserId(this ClaimsPrincipal principal) =>
        principal.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new InvalidOperationException("The authenticated StudyLens account has no user identifier.");
}

public sealed record AccountView(string UserId, string Username, string DisplayName, string? Email, string? PictureUrl);
public sealed record QuotaCounterView(string ResourceType, int Limit, int Used, int Reserved, int Remaining, DateTimeOffset ResetAtUtc);
public sealed record AccountQuotaView(string ContractVersion, IReadOnlyList<QuotaCounterView> Items);
public sealed record TokenPairView(string ContractVersion, string AccessToken, DateTimeOffset AccessExpiresAtUtc,
    string RefreshToken, DateTimeOffset RefreshExpiresAtUtc, AccountView Account);

public sealed record QuotaDecision(bool Allowed, string? ReservationId, QuotaCounterView Counter)
{
    public static QuotaDecision Granted(string reservationId, QuotaCounterView counter) => new(true, reservationId, counter);
    public static QuotaDecision Denied(QuotaCounterView counter) => new(false, null, counter);
}
