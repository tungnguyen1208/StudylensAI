using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudyLens.Api.Infrastructure.Persistence.Migrations;

[DbContext(typeof(StudyLensDbContext))]
[Migration("20260929090000_AddFullVideoLearningPackages")]
public partial class AddFullVideoLearningPackages : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>("SessionId", "TranscriptCaptures", type: "TEXT", maxLength: 64, nullable: true);
        migrationBuilder.AddColumn<string>("ContentHash", "TranscriptCaptures", type: "TEXT", maxLength: 64, nullable: true);
        migrationBuilder.AddColumn<long>("DurationMs", "TranscriptCaptures", type: "INTEGER", nullable: true);
        migrationBuilder.AddColumn<string>("Status", "QuizAssessments", type: "TEXT", maxLength: 16, nullable: false, defaultValue: "ready");
        migrationBuilder.AddColumn<string>("QuestionType", "QuizAssessments", type: "TEXT", maxLength: 32, nullable: false, defaultValue: "multipleChoice");
        migrationBuilder.AddColumn<string>("Difficulty", "QuizAssessments", type: "TEXT", maxLength: 16, nullable: false, defaultValue: "medium");
        migrationBuilder.AddColumn<string>("TranscriptCaptureId", "QuizAssessments", type: "TEXT", maxLength: 64, nullable: true);
        migrationBuilder.AddColumn<string>("Explanation", "QuestionAssessments", type: "TEXT", nullable: false, defaultValue: "");

        migrationBuilder.CreateTable("Videos", table => new
        {
            YoutubeVideoId = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
            Title = table.Column<string>(type: "TEXT", nullable: false),
            CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
            LastSeenAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
        }, constraints: table => table.PrimaryKey("PK_Videos", item => item.YoutubeVideoId));

        migrationBuilder.CreateTable("StudySessions", table => new
        {
            SessionId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
            ActivationId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
            StartIdempotencyKey = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
            YoutubeVideoId = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
            VideoTitle = table.Column<string>(type: "TEXT", nullable: false),
            QuestionType = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
            Difficulty = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
            Status = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
            TranscriptStatus = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
            QuizStatus = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
            TranscriptCaptureId = table.Column<string>(type: "TEXT", nullable: true),
            QuizId = table.Column<string>(type: "TEXT", nullable: true),
            TranscriptSubmissionKey = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
            TranscriptSubmissionFingerprint = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
            ErrorOperation = table.Column<string>(type: "TEXT", maxLength: 32, nullable: true),
            ErrorCode = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
            ErrorMessage = table.Column<string>(type: "TEXT", nullable: true),
            ErrorRetryable = table.Column<bool>(type: "INTEGER", nullable: false),
            StartedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
            CompletedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
            CompletionId = table.Column<string>(type: "TEXT", nullable: true),
            CompletionReason = table.Column<string>(type: "TEXT", nullable: true),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_StudySessions", item => item.SessionId);
            table.ForeignKey("FK_StudySessions_Videos_YoutubeVideoId", item => item.YoutubeVideoId, "Videos", "YoutubeVideoId", onDelete: ReferentialAction.Restrict);
        });

        migrationBuilder.CreateTable("ProcessingJobs", table => new
        {
            ProcessingJobId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
            SessionId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
            JobType = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
            Status = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
            IdempotencyKey = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
            AttemptCount = table.Column<int>(type: "INTEGER", nullable: false),
            MaxAttempts = table.Column<int>(type: "INTEGER", nullable: false),
            LastErrorCode = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
            LastErrorMessage = table.Column<string>(type: "TEXT", nullable: true),
            LastErrorRetryable = table.Column<bool>(type: "INTEGER", nullable: false),
            CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
            UpdatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_ProcessingJobs", item => item.ProcessingJobId);
            table.ForeignKey("FK_ProcessingJobs_StudySessions_SessionId", item => item.SessionId, "StudySessions", "SessionId", onDelete: ReferentialAction.Cascade);
        });

        migrationBuilder.CreateTable("QuestionOptions", table => new
        {
            QuestionOptionId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
            QuestionId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
            OptionId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
            Text = table.Column<string>(type: "TEXT", nullable: false),
            Position = table.Column<int>(type: "INTEGER", nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_QuestionOptions", item => item.QuestionOptionId);
            table.ForeignKey("FK_QuestionOptions_QuestionAssessments_QuestionId", item => item.QuestionId, "QuestionAssessments", "QuestionId", onDelete: ReferentialAction.Cascade);
        });

        migrationBuilder.CreateTable("QuizAttempts", table => new
        {
            QuizAttemptId = table.Column<string>(type: "TEXT", nullable: false),
            ClientAttemptId = table.Column<string>(type: "TEXT", maxLength: 128, nullable: false),
            QuizId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
            SessionId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
            Score = table.Column<double>(type: "REAL", nullable: false),
            SubmittedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
        }, constraints: table => table.PrimaryKey("PK_QuizAttempts", item => item.QuizAttemptId));

        migrationBuilder.CreateTable("AttemptAnswers", table => new
        {
            AttemptAnswerId = table.Column<string>(type: "TEXT", nullable: false),
            QuizAttemptId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
            QuestionId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
            YoutubeVideoId = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
            QuestionPrompt = table.Column<string>(type: "TEXT", nullable: false),
            QuestionType = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
            SubmittedAnswer = table.Column<string>(type: "TEXT", nullable: false),
            Outcome = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
            Score = table.Column<double>(type: "REAL", nullable: false),
            ReferenceAnswer = table.Column<string>(type: "TEXT", nullable: false),
            Explanation = table.Column<string>(type: "TEXT", nullable: false),
            SourceStartMs = table.Column<long>(type: "INTEGER", nullable: false),
            SourceEndMs = table.Column<long>(type: "INTEGER", nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_AttemptAnswers", item => item.AttemptAnswerId);
            table.ForeignKey("FK_AttemptAnswers_QuizAttempts_QuizAttemptId", item => item.QuizAttemptId, "QuizAttempts", "QuizAttemptId", onDelete: ReferentialAction.Cascade);
        });

        migrationBuilder.CreateIndex("IX_TranscriptCaptures_SessionId", "TranscriptCaptures", "SessionId");
        migrationBuilder.CreateIndex("IX_StudySessions_ActivationId", "StudySessions", "ActivationId", unique: true);
        migrationBuilder.CreateIndex("IX_StudySessions_StartIdempotencyKey", "StudySessions", "StartIdempotencyKey", unique: true);
        migrationBuilder.CreateIndex("IX_StudySessions_TranscriptSubmissionKey", "StudySessions", "TranscriptSubmissionKey", unique: true);
        migrationBuilder.CreateIndex("IX_StudySessions_YoutubeVideoId", "StudySessions", "YoutubeVideoId");
        migrationBuilder.CreateIndex("IX_ProcessingJobs_IdempotencyKey", "ProcessingJobs", "IdempotencyKey", unique: true);
        migrationBuilder.CreateIndex("IX_ProcessingJobs_SessionId", "ProcessingJobs", "SessionId");
        migrationBuilder.CreateIndex("IX_ProcessingJobs_Status_CreatedAtUtc", "ProcessingJobs", new[] { "Status", "CreatedAtUtc" });
        migrationBuilder.CreateIndex("IX_QuestionOptions_QuestionId_OptionId", "QuestionOptions", new[] { "QuestionId", "OptionId" }, unique: true);
        migrationBuilder.CreateIndex("IX_QuizAttempts_ClientAttemptId", "QuizAttempts", "ClientAttemptId", unique: true);
        migrationBuilder.CreateIndex("IX_AttemptAnswers_QuizAttemptId_QuestionId", "AttemptAnswers", new[] { "QuizAttemptId", "QuestionId" }, unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable("AttemptAnswers");
        migrationBuilder.DropTable("ProcessingJobs");
        migrationBuilder.DropTable("QuestionOptions");
        migrationBuilder.DropTable("QuizAttempts");
        migrationBuilder.DropTable("StudySessions");
        migrationBuilder.DropTable("Videos");
        migrationBuilder.DropIndex("IX_TranscriptCaptures_SessionId", "TranscriptCaptures");
        migrationBuilder.DropColumn("SessionId", "TranscriptCaptures");
        migrationBuilder.DropColumn("ContentHash", "TranscriptCaptures");
        migrationBuilder.DropColumn("DurationMs", "TranscriptCaptures");
        migrationBuilder.DropColumn("Status", "QuizAssessments");
        migrationBuilder.DropColumn("QuestionType", "QuizAssessments");
        migrationBuilder.DropColumn("Difficulty", "QuizAssessments");
        migrationBuilder.DropColumn("TranscriptCaptureId", "QuizAssessments");
        migrationBuilder.DropColumn("Explanation", "QuestionAssessments");
    }
}
