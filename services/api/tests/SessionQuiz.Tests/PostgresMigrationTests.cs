using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using StudyLens.Api.Infrastructure.Persistence;
using Xunit;

namespace SessionQuiz.Tests;

public sealed class PostgresMigrationTests
{
    [Fact]
    public void MigrationScript_UsesPostgresNativeTypes_ForFullVideoSchema()
    {
        var options = new DbContextOptionsBuilder<StudyLensDbContext>()
            .UseNpgsql("Host=localhost;Database=studylens_test;Username=studylens;Password=test")
            .Options;
        using var db = new StudyLensDbContext(options);

        var script = db.GetService<IMigrator>().GenerateScript().ToLowerInvariant();

        Assert.Contains("timestamp with time zone", script);
        Assert.Contains("boolean", script);
        Assert.Contains("\"durationms\"", script);
        Assert.Contains("\"promptversion\"", script);
        Assert.Contains("ix_quizassessments_youtubevideoid", script);
        Assert.Contains("ix_quizattempts_sessionid", script);
        Assert.Contains("ix_attemptanswers_youtubevideoid", script);
        Assert.DoesNotContain("autoincrement", script);
    }
}
