using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using StudyLens.Api.BuildingBlocks.Errors;
using StudyLens.Api.Features.Accounts.Application;
using StudyLens.Api.Features.Accounts.Infrastructure;

namespace StudyLens.Api.Features.Accounts;

public static class AccountsModule
{
    public const string ReadPolicy = "account-read";
    public const string WritePolicy = "account-write";
    public const string AuthPolicy = "auth-entry";
    public const string RefreshPolicy = "auth-refresh";

    public static IServiceCollection AddAccountsModule(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<IPasswordHasher<LocalCredentialEntity>, PasswordHasher<LocalCredentialEntity>>();
        services.AddScoped<QuotaService>();
        services.AddHostedService<QuotaReservationRecoveryService>();
        services.AddScoped<AccountAuthService>();
        services.AddAuthentication(StudyLensTokenAuthenticationHandler.AuthenticationScheme)
            .AddScheme<AuthenticationSchemeOptions, StudyLensTokenAuthenticationHandler>(
                StudyLensTokenAuthenticationHandler.AuthenticationScheme, _ => { });
        services.AddAuthorization();
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, cancellationToken) =>
            {
                var retry = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter)
                    ? Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)) : 60;
                context.HttpContext.Response.Headers.RetryAfter = retry.ToString(System.Globalization.CultureInfo.InvariantCulture);
                await context.HttpContext.Response.WriteAsJsonAsync(new ErrorEnvelope("rateLimited", 429,
                    $"Too many requests. Try again in {retry} seconds.", context.HttpContext.TraceIdentifier, true), cancellationToken);
            };
            options.AddPolicy(ReadPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "anonymous",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }));
            options.AddPolicy(WritePolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "anonymous",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }));
            options.AddPolicy(AuthPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "local",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }));
            // A valid refresh token is already high entropy and rotates on use. It must not
            // consume the small interactive login/register budget shared by the same browser IP.
            options.AddPolicy(RefreshPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "local",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }));
        });
        return services;
    }

    public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/auth/register", async (AuthRegisterRequest request, AccountAuthService service, HttpContext context, CancellationToken ct) =>
            TokenResponse(await service.RegisterAsync(request.ContractVersion, request.Username, request.Password, request.DisplayName, ct), context))
            .RequireRateLimiting(AuthPolicy);
        endpoints.MapPost("/api/auth/login", async (AuthLoginRequest request, AccountAuthService service, HttpContext context, CancellationToken ct) =>
            TokenResponse(await service.LoginAsync(request.ContractVersion, request.Username, request.Password, ct), context))
            .RequireRateLimiting(AuthPolicy);
        endpoints.MapPost("/api/auth/refresh", async (AuthRefreshRequest request, AccountAuthService service, HttpContext context, CancellationToken ct) =>
            TokenResponse(await service.RefreshAsync(request.ContractVersion, request.RefreshToken, ct), context)).RequireRateLimiting(RefreshPolicy);
        endpoints.MapPost("/api/auth/logout", async (AuthLogoutRequest request, AccountAuthService service, HttpContext context, CancellationToken ct) =>
        {
            if (request.ContractVersion != AccountAuthService.ContractVersion || string.IsNullOrWhiteSpace(request.RefreshToken))
                return Results.Json(new ErrorEnvelope("invalidAuthRequest", 400,
                    "A valid 0.7.0 logout request is required.", context.TraceIdentifier), statusCode: 400);
            await service.LogoutAsync(context.User.UserId(), request.RefreshToken, ct);
            return Results.NoContent();
        }).RequireAuthorization().RequireRateLimiting(WritePolicy);
        endpoints.MapGet("/api/account", async (AccountAuthService service, HttpContext context, CancellationToken ct) =>
        {
            var account = await service.ReadAccountAsync(context.User.UserId(), ct);
            return account is null ? Results.NotFound() : Results.Ok(new { contractVersion = AccountAuthService.ContractVersion, account });
        }).RequireAuthorization().RequireRateLimiting(ReadPolicy);
        endpoints.MapPost("/api/account/password", async (PasswordChangeRequest request, AccountAuthService service, HttpContext context, CancellationToken ct) =>
        {
            var result = await service.ChangePasswordAsync(context.User.UserId(), request.ContractVersion,
                request.CurrentPassword, request.NewPassword, ct);
            return result.Changed ? Results.NoContent() : Results.Json(new ErrorEnvelope(result.ErrorCode!, 400,
                result.ErrorMessage!, context.TraceIdentifier), statusCode: 400);
        }).RequireAuthorization().RequireRateLimiting(WritePolicy);
        endpoints.MapGet("/api/account/quota", async (QuotaService service, HttpContext context, CancellationToken ct) =>
            Results.Ok(await service.ReadAsync(context.User.UserId(), ct))).RequireAuthorization().RequireRateLimiting(ReadPolicy);
        return endpoints;
    }

    private static IResult TokenResponse(TokenResult result, HttpContext context) => result.Tokens is not null
        ? Results.Ok(result.Tokens)
        : Results.Json(new ErrorEnvelope(result.ErrorCode!, result.StatusCode, result.ErrorMessage!, context.TraceIdentifier), statusCode: result.StatusCode);
}

internal sealed record AuthRegisterRequest(string ContractVersion, string Username, string Password, string DisplayName);
internal sealed record AuthLoginRequest(string ContractVersion, string Username, string Password);
internal sealed record AuthRefreshRequest(string ContractVersion, string RefreshToken);
internal sealed record AuthLogoutRequest(string ContractVersion, string RefreshToken);
internal sealed record PasswordChangeRequest(string ContractVersion, string CurrentPassword, string NewPassword);
