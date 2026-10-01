using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudyLens.Api.Infrastructure.Persistence.Migrations;

[DbContext(typeof(StudyLensDbContext))]
[Migration("20260920230000_AddQuizAssessmentAndAnswerHistory")]
public partial class AddQuizAssessmentAndAnswerHistory : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "QuizAssessments",
            columns: table => new
            {
                QuizId = table.Column<string>(nullable: false),
                IdempotencyKey = table.Column<string>(maxLength: 200, nullable: false),
                SessionId = table.Column<string>(maxLength: 64, nullable: false),
                SegmentId = table.Column<string>(maxLength: 64, nullable: false),
                YoutubeVideoId = table.Column<string>(maxLength: 32, nullable: false),
                CreatedAtUtc = table.Column<DateTimeOffset>(nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_QuizAssessments", item => item.QuizId));

        migrationBuilder.CreateTable(
            name: "AnswerAttempts",
            columns: table => new
            {
                AnswerAttemptId = table.Column<string>(nullable: false),
                ClientAttemptId = table.Column<string>(maxLength: 128, nullable: false),
                QuizId = table.Column<string>(maxLength: 64, nullable: false),
                SessionId = table.Column<string>(maxLength: 64, nullable: false),
                QuestionId = table.Column<string>(maxLength: 64, nullable: false),
                YoutubeVideoId = table.Column<string>(maxLength: 32, nullable: false),
                QuestionPrompt = table.Column<string>(nullable: false),
                QuestionType = table.Column<string>(maxLength: 32, nullable: false),
                SubmittedAnswer = table.Column<string>(nullable: false),
                Outcome = table.Column<string>(maxLength: 32, nullable: false),
                Score = table.Column<double>(nullable: false),
                ReferenceAnswer = table.Column<string>(nullable: false),
                Explanation = table.Column<string>(nullable: false),
                SourceStartMs = table.Column<long>(nullable: false),
                SourceEndMs = table.Column<long>(nullable: false),
                GradedAtUtc = table.Column<DateTimeOffset>(nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_AnswerAttempts", item => item.AnswerAttemptId));

        migrationBuilder.CreateTable(
            name: "QuestionAssessments",
            columns: table => new
            {
                QuestionId = table.Column<string>(nullable: false),
                QuizId = table.Column<string>(nullable: false),
                Type = table.Column<string>(maxLength: 32, nullable: false),
                Prompt = table.Column<string>(nullable: false),
                CorrectOptionId = table.Column<string>(nullable: true),
                ReferenceAnswer = table.Column<string>(nullable: true),
                YoutubeVideoId = table.Column<string>(maxLength: 32, nullable: false),
                SourceStartMs = table.Column<long>(nullable: false),
                SourceEndMs = table.Column<long>(nullable: false),
                OptionsJson = table.Column<string>(nullable: true),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_QuestionAssessments", item => item.QuestionId);
                table.ForeignKey("FK_QuestionAssessments_QuizAssessments_QuizId", item => item.QuizId, "QuizAssessments", "QuizId", onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(name: "IX_QuizAssessments_IdempotencyKey", table: "QuizAssessments", column: "IdempotencyKey", unique: true);
        migrationBuilder.CreateIndex(name: "IX_QuestionAssessments_QuizId", table: "QuestionAssessments", column: "QuizId");
        migrationBuilder.CreateIndex(name: "IX_AnswerAttempts_ClientAttemptId", table: "AnswerAttempts", column: "ClientAttemptId", unique: true);
        migrationBuilder.CreateIndex(name: "IX_AnswerAttempts_YoutubeVideoId_GradedAtUtc", table: "AnswerAttempts", columns: new[] { "YoutubeVideoId", "GradedAtUtc" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "AnswerAttempts");
        migrationBuilder.DropTable(name: "QuestionAssessments");
        migrationBuilder.DropTable(name: "QuizAssessments");
    }
}
