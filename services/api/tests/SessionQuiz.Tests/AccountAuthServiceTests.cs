using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using StudyLens.Api.Features.Accounts.Application;
using StudyLens.Api.Features.Accounts.Infrastructure;
using StudyLens.Api.Infrastructure.Persistence;
using Xunit;

namespace SessionQuiz.Tests;

public sealed class AccountAuthServiceTests
{
    private const string Password = "correct horse battery 1";

    [Fact]
    public async Task Register_UsesCaseInsensitiveUniqueUsername_AndStoresOnlyPasswordHash()
    {
        await using var fixture = await Fixture.CreateAsync();

        var first = await fixture.Service.RegisterAsync("0.7.0", "Learner.One", Password, "Learner One", default);
        var duplicate = await fixture.Service.RegisterAsync("0.7.0", "learner.one", Password, "Other", default);
        var credential = Assert.Single(await fixture.Db.Set<LocalCredentialEntity>().ToArrayAsync());

        Assert.Equal(200, first.StatusCode);
        Assert.Equal("Learner.One", first.Tokens!.Account.Username);
        Assert.Equal(409, duplicate.StatusCode);
        Assert.Equal("usernameUnavailable", duplicate.ErrorCode);
        Assert.NotEqual(Password, credential.PasswordHash);
        Assert.DoesNotContain(Password, credential.PasswordHash, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("lettersOnly")]
    [InlineData("123456")]
    [InlineData("!")]
    public async Task Register_RequiresAtLeastOneLetterAndOneNumber(string password)
    {
        await using var fixture = await Fixture.CreateAsync();

        var result = await fixture.Service.RegisterAsync("0.7.0", "learner", password, "Learner", default);

        Assert.Equal(400, result.StatusCode);
        Assert.Equal("invalidRegistration", result.ErrorCode);
    }

    [Fact]
    public async Task Register_AcceptsShortPasswordWhenItContainsALetterAndANumber()
    {
        await using var fixture = await Fixture.CreateAsync();

        var result = await fixture.Service.RegisterAsync("0.7.0", "learner", "a1", "Learner", default);

        Assert.Equal(200, result.StatusCode);
    }

    [Fact]
    public async Task Login_ReturnsGenericFailure_AndLocksAfterFiveFailures()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.Service.RegisterAsync("0.7.0", "learner", Password, "Learner", default);

        for (var attempt = 0; attempt < 5; attempt++)
        {
            var failed = await fixture.Service.LoginAsync("0.7.0", "learner", "wrong password", default);
            Assert.Equal("invalidAuthCredential", failed.ErrorCode);
        }
        var locked = await fixture.Service.LoginAsync("0.7.0", "learner", Password, default);
        Assert.Equal(401, locked.StatusCode);

        fixture.Clock.Advance(TimeSpan.FromMinutes(5).Add(TimeSpan.FromSeconds(1)));
        var succeeded = await fixture.Service.LoginAsync("0.7.0", "LEARNER", Password, default);
        Assert.Equal(200, succeeded.StatusCode);
    }

    [Fact]
    public async Task Refresh_IsRotated_AndPasswordChangeRevokesEveryToken()
    {
        await using var fixture = await Fixture.CreateAsync();
        var registered = await fixture.Service.RegisterAsync("0.7.0", "learner", Password, "Learner", default);
        var refreshed = await fixture.Service.RefreshAsync("0.7.0", registered.Tokens!.RefreshToken, default);
        var replay = await fixture.Service.RefreshAsync("0.7.0", registered.Tokens.RefreshToken, default);

        Assert.Equal(200, refreshed.StatusCode);
        Assert.Equal(401, replay.StatusCode);

        var changed = await fixture.Service.ChangePasswordAsync(registered.Tokens.Account.UserId, "0.7.0",
            Password, "a completely new passphrase 2", default);
        var revokedRefresh = await fixture.Service.RefreshAsync("0.7.0", refreshed.Tokens!.RefreshToken, default);
        var oldLogin = await fixture.Service.LoginAsync("0.7.0", "learner", Password, default);
        var newLogin = await fixture.Service.LoginAsync("0.7.0", "learner", "a completely new passphrase 2", default);

        Assert.True(changed.Changed);
        Assert.Equal(401, revokedRefresh.StatusCode);
        Assert.Equal(401, oldLogin.StatusCode);
        Assert.Equal(200, newLogin.StatusCode);
    }

    [Fact]
    public async Task AdminReset_ClearsLockout_AndRevokesExistingTokens()
    {
        await using var fixture = await Fixture.CreateAsync();
        var registered = await fixture.Service.RegisterAsync("0.7.0", "learner", Password, "Learner", default);
        for (var attempt = 0; attempt < 5; attempt++)
            await fixture.Service.LoginAsync("0.7.0", "learner", "wrong password", default);

        var reset = await fixture.Service.ResetPasswordAsync("LEARNER", "admin supplied passphrase 3", default);
        var oldRefresh = await fixture.Service.RefreshAsync("0.7.0", registered.Tokens!.RefreshToken, default);
        var login = await fixture.Service.LoginAsync("0.7.0", "learner", "admin supplied passphrase 3", default);

        Assert.True(reset.Succeeded);
        Assert.Equal(401, oldRefresh.StatusCode);
        Assert.Equal(200, login.StatusCode);
    }

    [Fact]
    public async Task ConcurrentRegistration_AllowsOnlyOneNormalizedUsername()
    {
        var path = Path.Combine(Path.GetTempPath(), $"studylens-auth-{Guid.NewGuid():N}.db");
        try
        {
            var options = new DbContextOptionsBuilder<StudyLensDbContext>()
                .UseSqlite($"Data Source={path};Default Timeout=10;Pooling=False").Options;
            await using (var setup = new StudyLensDbContext(options)) await setup.Database.EnsureCreatedAsync();
            var clock = new MutableTimeProvider(DateTimeOffset.Parse("2026-10-15T12:00:00Z"));
            await using var firstDb = new StudyLensDbContext(options);
            await using var secondDb = new StudyLensDbContext(options);
            var first = new AccountAuthService(firstDb, new PasswordHasher<LocalCredentialEntity>(), clock);
            var second = new AccountAuthService(secondDb, new PasswordHasher<LocalCredentialEntity>(), clock);

            var results = await Task.WhenAll(
                first.RegisterAsync("0.7.0", "Learner.One", Password, "First", default),
                second.RegisterAsync("0.7.0", "learner.one", Password, "Second", default));

            Assert.Single(results, item => item.StatusCode == 200);
            Assert.Single(results, item => item.StatusCode == 409);
            await using var verification = new StudyLensDbContext(options);
            Assert.Equal(1, await verification.Set<LocalCredentialEntity>().CountAsync());
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public async Task AdminAssign_AddsCredentialWithoutReplacingLegacyAccount()
    {
        await using var fixture = await Fixture.CreateAsync();
        var userId = Guid.NewGuid().ToString();
        fixture.Db.Add(new AppUserEntity
        {
            UserId = userId, GoogleSubject = "legacy-google-subject", Email = "legacy@example.test",
            DisplayName = "Legacy Learner", CreatedAtUtc = fixture.Clock.GetUtcNow(), LastLoginAtUtc = fixture.Clock.GetUtcNow(),
        });
        await fixture.Db.SaveChangesAsync();

        var assigned = await fixture.Service.AssignCredentialAsync(userId, "legacy", Password, default);
        var login = await fixture.Service.LoginAsync("0.7.0", "legacy", Password, default);

        Assert.True(assigned.Succeeded);
        Assert.Equal(userId, login.Tokens!.Account.UserId);
        Assert.Equal("legacy@example.test", login.Tokens.Account.Email);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private Fixture(StudyLensDbContext db, AccountAuthService service, MutableTimeProvider clock)
        { Db = db; Service = service; Clock = clock; }

        public StudyLensDbContext Db { get; }
        public AccountAuthService Service { get; }
        public MutableTimeProvider Clock { get; }

        public static async Task<Fixture> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<StudyLensDbContext>().UseSqlite("Data Source=:memory:").Options;
            var db = new StudyLensDbContext(options);
            await db.Database.OpenConnectionAsync();
            await db.Database.EnsureCreatedAsync();
            var clock = new MutableTimeProvider(DateTimeOffset.Parse("2026-10-15T12:00:00Z"));
            return new Fixture(db, new AccountAuthService(db, new PasswordHasher<LocalCredentialEntity>(), clock), clock);
        }

        public async ValueTask DisposeAsync() => await Db.DisposeAsync();
    }

    private sealed class MutableTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        private DateTimeOffset current = utcNow;
        public override DateTimeOffset GetUtcNow() => current;
        public void Advance(TimeSpan duration) => current = current.Add(duration);
    }
}
