using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.Accounts.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;

namespace StudyLens.Api.Features.Accounts.Application;

public sealed partial class AccountAuthService(
    StudyLensDbContext db,
    IPasswordHasher<LocalCredentialEntity> passwordHasher,
    TimeProvider clock)
{
    public const string ContractVersion = "0.7.0";
    private const int MaxFailedAttempts = 5;
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(5);

    [GeneratedRegex("^[A-Za-z0-9._-]{3,32}$", RegexOptions.CultureInvariant)]
    private static partial Regex UsernamePattern();

    public async Task<TokenResult> RegisterAsync(string contractVersion, string username, string password,
        string displayName, CancellationToken cancellationToken)
    {
        var normalizedUsername = NormalizeUsername(username);
        var normalizedDisplayName = displayName.Trim();
        if (contractVersion != ContractVersion || normalizedUsername is null || !ValidPassword(password) ||
            normalizedDisplayName.Length is < 1 or > 200)
            return TokenResult.InvalidRequest("invalidRegistration", "Username, display name, or password is invalid.");

        var now = clock.GetUtcNow();
        var user = new AppUserEntity
        {
            UserId = Guid.NewGuid().ToString(), DisplayName = normalizedDisplayName,
            CreatedAtUtc = now, LastLoginAtUtc = now,
        };
        var credential = new LocalCredentialEntity
        {
            UserId = user.UserId, Username = username.Trim(), NormalizedUsername = normalizedUsername,
            PasswordChangedAtUtc = now,
        };
        credential.PasswordHash = passwordHasher.HashPassword(credential, password);
        db.AddRange(user, credential);
        var tokens = IssuePair(user, credential.Username, now);
        try { await db.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return TokenResult.Conflict("usernameUnavailable", "This username is unavailable.");
        }
        return TokenResult.Success(tokens);
    }

    public async Task<TokenResult> LoginAsync(string contractVersion, string username, string password,
        CancellationToken cancellationToken)
    {
        var normalizedUsername = NormalizeUsername(username);
        if (contractVersion != ContractVersion || normalizedUsername is null || password.Length is < 1 or > 128)
            return TokenResult.InvalidCredential();
        var now = clock.GetUtcNow();
        var credential = await db.Set<LocalCredentialEntity>()
            .SingleOrDefaultAsync(item => item.NormalizedUsername == normalizedUsername, cancellationToken);
        if (credential is null || credential.LockoutEndUtc is not null && credential.LockoutEndUtc > now)
            return TokenResult.InvalidCredential();

        var verification = passwordHasher.VerifyHashedPassword(credential, credential.PasswordHash, password);
        if (verification == PasswordVerificationResult.Failed)
        {
            credential.FailedAccessAttempts++;
            if (credential.FailedAccessAttempts >= MaxFailedAttempts)
            {
                credential.FailedAccessAttempts = 0;
                credential.LockoutEndUtc = now.Add(LockoutDuration);
            }
            await db.SaveChangesAsync(cancellationToken);
            return TokenResult.InvalidCredential();
        }

        credential.FailedAccessAttempts = 0;
        credential.LockoutEndUtc = null;
        if (verification == PasswordVerificationResult.SuccessRehashNeeded)
            credential.PasswordHash = passwordHasher.HashPassword(credential, password);
        var user = await db.Set<AppUserEntity>().SingleAsync(item => item.UserId == credential.UserId, cancellationToken);
        user.LastLoginAtUtc = now;
        var tokens = IssuePair(user, credential.Username, now);
        await db.SaveChangesAsync(cancellationToken);
        return TokenResult.Success(tokens);
    }

    public async Task<TokenResult> RefreshAsync(string contractVersion, string refreshToken, CancellationToken cancellationToken)
    {
        if (contractVersion != ContractVersion || string.IsNullOrWhiteSpace(refreshToken)) return TokenResult.InvalidCredential();
        var now = clock.GetUtcNow();
        var hash = StudyLensTokenAuthenticationHandler.TokenHash(refreshToken);
        var existing = await db.Set<AuthTokenEntity>().SingleOrDefaultAsync(item => item.TokenHash == hash &&
            item.TokenType == "refresh" && item.RevokedAtUtc == null, cancellationToken);
        if (existing is null || existing.ExpiresAtUtc <= now) return TokenResult.InvalidCredential();
        var credential = await db.Set<LocalCredentialEntity>().SingleOrDefaultAsync(item => item.UserId == existing.UserId, cancellationToken);
        var user = await db.Set<AppUserEntity>().SingleOrDefaultAsync(item => item.UserId == existing.UserId, cancellationToken);
        if (credential is null || user is null) return TokenResult.InvalidCredential();
        existing.RevokedAtUtc = now;
        var result = IssuePair(user, credential.Username, now);
        try { await db.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateConcurrencyException) { return TokenResult.InvalidCredential(); }
        return TokenResult.Success(result);
    }

    public async Task LogoutAsync(string userId, string? refreshToken, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var tokens = await db.Set<AuthTokenEntity>().Where(item => item.UserId == userId && item.RevokedAtUtc == null &&
            (item.TokenType == "access" || refreshToken != null && item.TokenHash == StudyLensTokenAuthenticationHandler.TokenHash(refreshToken)))
            .ToArrayAsync(cancellationToken);
        foreach (var token in tokens) token.RevokedAtUtc = now;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<PasswordChangeResult> ChangePasswordAsync(string userId, string contractVersion,
        string currentPassword, string newPassword, CancellationToken cancellationToken)
    {
        if (contractVersion != ContractVersion || !ValidPassword(newPassword) || currentPassword.Length is < 1 or > 128)
            return PasswordChangeResult.Invalid("invalidPasswordRequest", "The password change request is invalid.");
        var credential = await db.Set<LocalCredentialEntity>().SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken);
        if (credential is null || passwordHasher.VerifyHashedPassword(credential, credential.PasswordHash, currentPassword) == PasswordVerificationResult.Failed)
            return PasswordChangeResult.Invalid("invalidCurrentPassword", "The current password is incorrect.");
        var now = clock.GetUtcNow();
        credential.PasswordHash = passwordHasher.HashPassword(credential, newPassword);
        credential.PasswordChangedAtUtc = now;
        credential.FailedAccessAttempts = 0;
        credential.LockoutEndUtc = null;
        await RevokeAllTokensAsync(userId, now, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return PasswordChangeResult.Success();
    }

    public async Task<AccountView?> ReadAccountAsync(string userId, CancellationToken cancellationToken) =>
        await (from user in db.Set<AppUserEntity>().AsNoTracking()
               join credential in db.Set<LocalCredentialEntity>().AsNoTracking() on user.UserId equals credential.UserId
               where user.UserId == userId
               select new AccountView(user.UserId, credential.Username, user.DisplayName, user.Email, user.PictureUrl))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<AdminCredentialResult> AssignCredentialAsync(string userId, string username, string password,
        CancellationToken cancellationToken)
    {
        var normalized = NormalizeUsername(username);
        if (!Guid.TryParse(userId, out _) || normalized is null || !ValidPassword(password))
            return AdminCredentialResult.Invalid("The user ID, username, or password is invalid.");
        var user = await db.Set<AppUserEntity>().SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken);
        if (user is null) return AdminCredentialResult.Invalid("The account was not found.");
        if (await db.Set<LocalCredentialEntity>().AnyAsync(item => item.UserId == userId, cancellationToken))
            return AdminCredentialResult.Invalid("The account already has a local credential.");
        var credential = new LocalCredentialEntity
        {
            UserId = userId, Username = username.Trim(), NormalizedUsername = normalized,
            PasswordChangedAtUtc = clock.GetUtcNow(),
        };
        credential.PasswordHash = passwordHasher.HashPassword(credential, password);
        db.Add(credential);
        try { await db.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateException) { return AdminCredentialResult.Invalid("This username is unavailable."); }
        return AdminCredentialResult.Success(userId, credential.Username);
    }

    public async Task<AdminCredentialResult> ResetPasswordAsync(string username, string password,
        CancellationToken cancellationToken)
    {
        var normalized = NormalizeUsername(username);
        if (normalized is null || !ValidPassword(password)) return AdminCredentialResult.Invalid("The username or password is invalid.");
        var credential = await db.Set<LocalCredentialEntity>().SingleOrDefaultAsync(item => item.NormalizedUsername == normalized, cancellationToken);
        if (credential is null) return AdminCredentialResult.Invalid("The account was not found.");
        var now = clock.GetUtcNow();
        credential.PasswordHash = passwordHasher.HashPassword(credential, password);
        credential.PasswordChangedAtUtc = now;
        credential.FailedAccessAttempts = 0;
        credential.LockoutEndUtc = null;
        await RevokeAllTokensAsync(credential.UserId, now, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return AdminCredentialResult.Success(credential.UserId, credential.Username);
    }

    private TokenPairView IssuePair(AppUserEntity user, string username, DateTimeOffset now)
    {
        var access = Secret(); var refresh = Secret();
        var accessExpiry = now.AddMinutes(15); var refreshExpiry = now.AddDays(30);
        db.AddRange(
            new AuthTokenEntity { TokenHash = StudyLensTokenAuthenticationHandler.TokenHash(access), UserId = user.UserId, TokenType = "access", CreatedAtUtc = now, ExpiresAtUtc = accessExpiry },
            new AuthTokenEntity { TokenHash = StudyLensTokenAuthenticationHandler.TokenHash(refresh), UserId = user.UserId, TokenType = "refresh", CreatedAtUtc = now, ExpiresAtUtc = refreshExpiry });
        return new TokenPairView(ContractVersion, access, accessExpiry, refresh, refreshExpiry,
            new AccountView(user.UserId, username, user.DisplayName, user.Email, user.PictureUrl));
    }

    private async Task RevokeAllTokensAsync(string userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var tokens = await db.Set<AuthTokenEntity>().Where(item => item.UserId == userId && item.RevokedAtUtc == null).ToArrayAsync(cancellationToken);
        foreach (var token in tokens) token.RevokedAtUtc = now;
    }

    private static string? NormalizeUsername(string value)
    {
        var trimmed = value.Trim();
        return UsernamePattern().IsMatch(trimmed) ? trimmed.ToUpperInvariant() : null;
    }

    // The local-demo policy deliberately keeps the rule easy to understand:
    // a password needs at least one letter and one digit.  Do not trim it;
    // spaces and other Unicode characters remain part of the password.
    private static bool ValidPassword(string value) => value.Length is >= 2 and <= 128 &&
        value.Any(char.IsLetter) && value.Any(char.IsDigit);
    private static string Secret() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public sealed record TokenResult(TokenPairView? Tokens, string? ErrorCode, string? ErrorMessage, int StatusCode)
{
    public static TokenResult Success(TokenPairView tokens) => new(tokens, null, null, 200);
    public static TokenResult InvalidCredential() => new(null, "invalidAuthCredential", "The username or password is invalid.", 401);
    public static TokenResult InvalidRequest(string code, string message) => new(null, code, message, 400);
    public static TokenResult Conflict(string code, string message) => new(null, code, message, 409);
}

public sealed record PasswordChangeResult(bool Changed, string? ErrorCode, string? ErrorMessage)
{
    public static PasswordChangeResult Success() => new(true, null, null);
    public static PasswordChangeResult Invalid(string code, string message) => new(false, code, message);
}

public sealed record AdminCredentialResult(bool Succeeded, string? UserId, string? Username, string? Error)
{
    public static AdminCredentialResult Success(string userId, string username) => new(true, userId, username, null);
    public static AdminCredentialResult Invalid(string error) => new(false, null, null, error);
}
