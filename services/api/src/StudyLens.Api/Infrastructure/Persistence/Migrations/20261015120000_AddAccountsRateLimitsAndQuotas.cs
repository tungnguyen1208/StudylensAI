using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudyLens.Api.Infrastructure.Persistence.Migrations;

[DbContext(typeof(StudyLensDbContext))]
[Migration("20261015120000_AddAccountsRateLimitsAndQuotas")]
public partial class AddAccountsRateLimitsAndQuotas : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // The v0.6.0 upgrade is intentionally a clean multi-account boundary.
        // A verified pg_dump is required before this migration is applied.
        if (ActiveProvider.Contains("Npgsql", StringComparison.OrdinalIgnoreCase))
        {
            migrationBuilder.Sql("""
                TRUNCATE TABLE "AttemptAnswers", "QuizAttempts", "AnswerAttempts", "QuestionOptions",
                    "QuestionAssessments", "QuizAssessments", "ProcessingJobs", "TranscriptAudioChunks",
                    "TranscriptCaptureCues", "TranscriptCaptures", "StudySessions", "Videos" CASCADE;
                """);
        }
        else
        {
            foreach (var table in new[] { "AttemptAnswers", "QuizAttempts", "AnswerAttempts", "QuestionOptions",
                         "QuestionAssessments", "QuizAssessments", "ProcessingJobs", "TranscriptAudioChunks",
                         "TranscriptCaptureCues", "TranscriptCaptures", "StudySessions", "Videos" })
                migrationBuilder.Sql($"DELETE FROM \"{table}\";");
        }

        migrationBuilder.DropIndex("IX_StudySessions_ActivationId", "StudySessions");
        migrationBuilder.DropIndex("IX_StudySessions_StartIdempotencyKey", "StudySessions");
        migrationBuilder.DropIndex("IX_QuizAttempts_ClientAttemptId", "QuizAttempts");
        migrationBuilder.DropIndex("IX_AnswerAttempts_ClientAttemptId", "AnswerAttempts");
        migrationBuilder.DropIndex("IX_AnswerAttempts_YoutubeVideoId_GradedAtUtc", "AnswerAttempts");

        migrationBuilder.AddColumn<string>("UserId", "StudySessions", maxLength: 64, nullable: false, defaultValue: "");
        migrationBuilder.AddColumn<string>("QuizQuotaReservationId", "StudySessions", maxLength: 64, nullable: true);
        migrationBuilder.AddColumn<string>("QuotaReservationId", "ProcessingJobs", maxLength: 64, nullable: true);
        migrationBuilder.AddColumn<string>("UserId", "QuizAssessments", maxLength: 64, nullable: false, defaultValue: "");
        migrationBuilder.AddColumn<string>("UserId", "QuizAttempts", maxLength: 64, nullable: false, defaultValue: "");
        migrationBuilder.AddColumn<string>("UserId", "AnswerAttempts", maxLength: 64, nullable: false, defaultValue: "");

        migrationBuilder.CreateTable("AppUsers", table => new
        {
            UserId = table.Column<string>(maxLength: 64, nullable: false),
            GoogleSubject = table.Column<string>(maxLength: 128, nullable: false),
            Email = table.Column<string>(maxLength: 320, nullable: false),
            DisplayName = table.Column<string>(maxLength: 200, nullable: false),
            PictureUrl = table.Column<string>(maxLength: 2048, nullable: true),
            CreatedAtUtc = table.Column<DateTimeOffset>(nullable: false),
            LastLoginAtUtc = table.Column<DateTimeOffset>(nullable: false),
        }, constraints: table => table.PrimaryKey("PK_AppUsers", item => item.UserId));

        migrationBuilder.CreateTable("OAuthLoginStates", table => new
        {
            StateHash = table.Column<string>(maxLength: 64, nullable: false),
            Nonce = table.Column<string>(maxLength: 128, nullable: false),
            ExtensionRedirectUri = table.Column<string>(maxLength: 2048, nullable: false),
            ExpiresAtUtc = table.Column<DateTimeOffset>(nullable: false),
            UsedAtUtc = table.Column<DateTimeOffset>(nullable: true),
        }, constraints: table => table.PrimaryKey("PK_OAuthLoginStates", item => item.StateHash));

        migrationBuilder.CreateTable("AuthTickets", table => new
        {
            TicketHash = table.Column<string>(maxLength: 64, nullable: false),
            UserId = table.Column<string>(maxLength: 64, nullable: false),
            ExpiresAtUtc = table.Column<DateTimeOffset>(nullable: false),
            UsedAtUtc = table.Column<DateTimeOffset>(nullable: true),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_AuthTickets", item => item.TicketHash);
            table.ForeignKey("FK_AuthTickets_AppUsers_UserId", item => item.UserId, "AppUsers", "UserId", onDelete: ReferentialAction.Cascade);
        });

        migrationBuilder.CreateTable("AuthTokens", table => new
        {
            TokenHash = table.Column<string>(maxLength: 64, nullable: false),
            UserId = table.Column<string>(maxLength: 64, nullable: false),
            TokenType = table.Column<string>(maxLength: 16, nullable: false),
            CreatedAtUtc = table.Column<DateTimeOffset>(nullable: false),
            ExpiresAtUtc = table.Column<DateTimeOffset>(nullable: false),
            RevokedAtUtc = table.Column<DateTimeOffset>(nullable: true),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_AuthTokens", item => item.TokenHash);
            table.ForeignKey("FK_AuthTokens_AppUsers_UserId", item => item.UserId, "AppUsers", "UserId", onDelete: ReferentialAction.Cascade);
        });

        migrationBuilder.CreateTable("DailyQuotas", table => new
        {
            UserId = table.Column<string>(maxLength: 64, nullable: false),
            QuotaDateUtc = table.Column<DateOnly>(type: "date", nullable: false),
            ResourceType = table.Column<string>(maxLength: 32, nullable: false),
            Used = table.Column<int>(nullable: false),
            Reserved = table.Column<int>(nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_DailyQuotas", item => new { item.UserId, item.QuotaDateUtc, item.ResourceType });
            table.ForeignKey("FK_DailyQuotas_AppUsers_UserId", item => item.UserId, "AppUsers", "UserId", onDelete: ReferentialAction.Cascade);
        });

        migrationBuilder.CreateTable("QuotaReservations", table => new
        {
            QuotaReservationId = table.Column<string>(maxLength: 64, nullable: false),
            UserId = table.Column<string>(maxLength: 64, nullable: false),
            QuotaDateUtc = table.Column<DateOnly>(type: "date", nullable: false),
            ResourceType = table.Column<string>(maxLength: 32, nullable: false),
            OperationKey = table.Column<string>(maxLength: 200, nullable: false),
            Units = table.Column<int>(nullable: false),
            Status = table.Column<string>(maxLength: 16, nullable: false),
            CreatedAtUtc = table.Column<DateTimeOffset>(nullable: false),
            UpdatedAtUtc = table.Column<DateTimeOffset>(nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_QuotaReservations", item => item.QuotaReservationId);
            table.ForeignKey("FK_QuotaReservations_AppUsers_UserId", item => item.UserId, "AppUsers", "UserId", onDelete: ReferentialAction.Cascade);
        });

        migrationBuilder.CreateIndex("IX_AppUsers_GoogleSubject", "AppUsers", "GoogleSubject", unique: true);
        migrationBuilder.CreateIndex("IX_AuthTickets_UserId", "AuthTickets", "UserId");
        migrationBuilder.CreateIndex("IX_AuthTokens_UserId_TokenType", "AuthTokens", new[] { "UserId", "TokenType" });
        migrationBuilder.CreateIndex("IX_DailyQuotas_UserId", "DailyQuotas", "UserId");
        migrationBuilder.CreateIndex("IX_QuotaReservations_UserId_ResourceType_OperationKey", "QuotaReservations",
            new[] { "UserId", "ResourceType", "OperationKey" }, unique: true);
        migrationBuilder.CreateIndex("IX_StudySessions_UserId_ActivationId", "StudySessions", new[] { "UserId", "ActivationId" }, unique: true);
        migrationBuilder.CreateIndex("IX_StudySessions_UserId_StartIdempotencyKey", "StudySessions", new[] { "UserId", "StartIdempotencyKey" }, unique: true);
        migrationBuilder.CreateIndex("IX_QuizAttempts_UserId_ClientAttemptId", "QuizAttempts", new[] { "UserId", "ClientAttemptId" }, unique: true);
        migrationBuilder.CreateIndex("IX_AnswerAttempts_UserId_ClientAttemptId", "AnswerAttempts", new[] { "UserId", "ClientAttemptId" }, unique: true);
        migrationBuilder.CreateIndex("IX_AnswerAttempts_UserId_YoutubeVideoId_GradedAtUtc", "AnswerAttempts",
            new[] { "UserId", "YoutubeVideoId", "GradedAtUtc" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable("AuthTickets");
        migrationBuilder.DropTable("AuthTokens");
        migrationBuilder.DropTable("DailyQuotas");
        migrationBuilder.DropTable("OAuthLoginStates");
        migrationBuilder.DropTable("QuotaReservations");
        migrationBuilder.DropTable("AppUsers");
        migrationBuilder.DropIndex("IX_StudySessions_UserId_ActivationId", "StudySessions");
        migrationBuilder.DropIndex("IX_StudySessions_UserId_StartIdempotencyKey", "StudySessions");
        migrationBuilder.DropIndex("IX_QuizAttempts_UserId_ClientAttemptId", "QuizAttempts");
        migrationBuilder.DropIndex("IX_AnswerAttempts_UserId_ClientAttemptId", "AnswerAttempts");
        migrationBuilder.DropIndex("IX_AnswerAttempts_UserId_YoutubeVideoId_GradedAtUtc", "AnswerAttempts");
        migrationBuilder.DropColumn("UserId", "StudySessions");
        migrationBuilder.DropColumn("QuizQuotaReservationId", "StudySessions");
        migrationBuilder.DropColumn("QuotaReservationId", "ProcessingJobs");
        migrationBuilder.DropColumn("UserId", "QuizAssessments");
        migrationBuilder.DropColumn("UserId", "QuizAttempts");
        migrationBuilder.DropColumn("UserId", "AnswerAttempts");
        migrationBuilder.CreateIndex("IX_StudySessions_ActivationId", "StudySessions", "ActivationId", unique: true);
        migrationBuilder.CreateIndex("IX_StudySessions_StartIdempotencyKey", "StudySessions", "StartIdempotencyKey", unique: true);
        migrationBuilder.CreateIndex("IX_QuizAttempts_ClientAttemptId", "QuizAttempts", "ClientAttemptId", unique: true);
        migrationBuilder.CreateIndex("IX_AnswerAttempts_ClientAttemptId", "AnswerAttempts", "ClientAttemptId", unique: true);
        migrationBuilder.CreateIndex("IX_AnswerAttempts_YoutubeVideoId_GradedAtUtc", "AnswerAttempts", new[] { "YoutubeVideoId", "GradedAtUtc" });
    }
}
