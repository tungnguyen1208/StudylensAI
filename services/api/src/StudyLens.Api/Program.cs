using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using StudyLens.Api.BuildingBlocks.Health;
using StudyLens.Api.BuildingBlocks.Http;
using StudyLens.Api.BuildingBlocks.Errors;
using StudyLens.Api.Features.AssessmentHistory;
using StudyLens.Api.Features.Accounts;
using StudyLens.Api.Features.Accounts.Application;
using StudyLens.Api.Features.SessionQuiz;
using StudyLens.Api.Features.VideoActivation;
using StudyLens.Api.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);
var migrateOnly = args.Any(argument => string.Equals(argument, "--migrate-only", StringComparison.OrdinalIgnoreCase));
var migrationTarget = args.FirstOrDefault(argument => argument.StartsWith("--migrate-to=", StringComparison.OrdinalIgnoreCase))
    ?.Split('=', 2)[1];
var accountAdminAction = args.FirstOrDefault(argument => argument.StartsWith("--account-admin=", StringComparison.OrdinalIgnoreCase))
    ?.Split('=', 2)[1].ToLowerInvariant();

// Add services to the container
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Production accepts only explicitly configured Extension origins. Development
// can add localhost origins without weakening the release policy.
builder.Services.AddCors(options =>
{
    options.AddPolicy("StudyLensClients", policy =>
    {
        var configuredOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
        var developmentOrigins = builder.Environment.IsDevelopment()
            ? new[] { "http://localhost:3000", "http://localhost:5173" }
            : [];
        var allowedOrigins = configuredOrigins.Concat(developmentOrigins)
            .Where(origin => !string.IsNullOrWhiteSpace(origin))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (allowedOrigins.Length > 0) policy.WithOrigins(allowedOrigins);
        policy.AllowAnyHeader().AllowAnyMethod();
    });
});

// PostgreSQL is the runtime persistence provider. Unit tests can still use
// SQLite explicitly through DbContextOptions without changing production data.
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connectionString))
    throw new InvalidOperationException("ConnectionStrings:DefaultConnection must be configured for PostgreSQL.");
builder.Services.AddDbContext<StudyLensDbContext>(options =>
{
    options.UseNpgsql(connectionString, npgsql => npgsql.EnableRetryOnFailure());
});

// Register AI Health Client
builder.Services.AddHttpClient<AiHealthClient>();

// Register Vertical Feature Modules (Dev 1, Dev 2, Dev 3)
builder.Services.AddAccountsModule(builder.Configuration);
builder.Services.AddVideoActivationModule(builder.Configuration);
builder.Services.AddSessionQuizModule(builder.Configuration);
builder.Services.AddAssessmentHistoryModule(builder.Configuration);

var app = builder.Build();

if (accountAdminAction is not null)
{
    var username = args.FirstOrDefault(argument => argument.StartsWith("--username=", StringComparison.OrdinalIgnoreCase))?.Split('=', 2)[1] ?? string.Empty;
    var userId = args.FirstOrDefault(argument => argument.StartsWith("--user-id=", StringComparison.OrdinalIgnoreCase))?.Split('=', 2)[1] ?? string.Empty;
    var password = await Console.In.ReadLineAsync() ?? string.Empty;
    await using var scope = app.Services.CreateAsyncScope();
    var auth = scope.ServiceProvider.GetRequiredService<AccountAuthService>();
    var result = accountAdminAction switch
    {
        "reset" => await auth.ResetPasswordAsync(username, password, CancellationToken.None),
        "assign" => await auth.AssignCredentialAsync(userId, username, password, CancellationToken.None),
        _ => AdminCredentialResult.Invalid("Supported account admin actions are assign and reset."),
    };
    if (!result.Succeeded)
    {
        Console.Error.WriteLine(result.Error);
        Environment.ExitCode = 1;
    }
    else
    {
        Console.WriteLine($"Account credential updated for {result.Username} ({result.UserId}). Existing sessions were revoked when applicable.");
    }
    return;
}

if (migrateOnly || app.Environment.IsDevelopment())
{
    await using var scope = app.Services.CreateAsyncScope();
    var database = scope.ServiceProvider.GetRequiredService<StudyLensDbContext>();
    if (migrateOnly)
        await database.GetService<IMigrator>().MigrateAsync(migrationTarget);
    else
        await database.Database.MigrateAsync();
    if (migrateOnly) return;
}

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Every unexpected API failure remains safe for the extension to display and retry.
// Exception details are intentionally never serialized to the Browser Extension.
app.UseExceptionHandler(handler => handler.Run(async context =>
{
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await context.Response.WriteAsJsonAsync(new ErrorEnvelope(
        "internalServerError",
        StatusCodes.Status500InternalServerError,
        "The Backend could not complete this request. Please try again.",
        context.TraceIdentifier,
        true));
}));

app.UseCors("StudyLensClients");
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

// Map Health Endpoints
app.MapHealthEndpoints();
app.MapAccountEndpoints();

// Map Vertical Feature Endpoints
app.MapVideoActivationEndpoints();
app.MapSessionQuizEndpoints();
app.MapAssessmentHistoryEndpoints();

app.Run();
