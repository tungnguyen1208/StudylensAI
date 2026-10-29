using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using StudyLens.Api.Features.Accounts.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;
using StudyLens.Api.BuildingBlocks.Errors;

namespace StudyLens.Api.Features.Accounts.Application;

public sealed class StudyLensTokenAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    StudyLensDbContext db,
    TimeProvider clock) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string AuthenticationScheme = "StudyLensBearer";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var authorization = Request.Headers.Authorization.ToString();
        if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return AuthenticateResult.NoResult();
        var rawToken = authorization[7..].Trim();
        if (rawToken.Length < 32) return AuthenticateResult.Fail("Invalid StudyLens bearer token.");
        var hash = TokenHash(rawToken);
        var now = clock.GetUtcNow();
        var token = await db.Set<AuthTokenEntity>().AsNoTracking().SingleOrDefaultAsync(item =>
            item.TokenHash == hash && item.TokenType == "access" && item.RevokedAtUtc == null);
        if (token is null || token.ExpiresAtUtc <= now)
            return AuthenticateResult.Fail("The StudyLens bearer token is invalid or expired.");
        var user = await db.Set<AppUserEntity>().AsNoTracking().SingleOrDefaultAsync(item => item.UserId == token.UserId);
        if (user is null) return AuthenticateResult.Fail("The StudyLens account no longer exists.");
        var credential = await db.Set<LocalCredentialEntity>().AsNoTracking()
            .SingleOrDefaultAsync(item => item.UserId == user.UserId);
        if (credential is null) return AuthenticateResult.Fail("The StudyLens account has no local credential.");
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.UserId),
            new(ClaimTypes.Name, user.DisplayName),
            new("studylens_username", credential.Username),
        };
        if (!string.IsNullOrWhiteSpace(user.Email)) claims.Add(new Claim(ClaimTypes.Email, user.Email));
        var identity = new ClaimsIdentity(claims, AuthenticationScheme);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), AuthenticationScheme));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Response.WriteAsJsonAsync(new ErrorEnvelope("authenticationRequired", 401,
            "A valid StudyLens bearer token is required.", Context.TraceIdentifier, false));
    }

    protected override Task HandleForbiddenAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status403Forbidden;
        return Response.WriteAsJsonAsync(new ErrorEnvelope("forbidden", 403,
            "This StudyLens account cannot access the requested resource.", Context.TraceIdentifier, false));
    }

    internal static string TokenHash(string rawToken) =>
        Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(rawToken))).ToLowerInvariant();
}
