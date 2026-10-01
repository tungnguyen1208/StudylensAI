using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudyLens.Api.Infrastructure.Persistence.Migrations;

[DbContext(typeof(StudyLensDbContext))]
[Migration("20261001090000_AddPostgresQuizMetadata")]
public partial class AddPostgresQuizMetadata : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<long>(
            name: "DurationMs",
            table: "Videos",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "ModelName",
            table: "QuizAssessments",
            maxLength: 128,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "PromptVersion",
            table: "QuizAssessments",
            maxLength: 16,
            nullable: false,
            defaultValue: "0.5.0");

        migrationBuilder.AddColumn<int>(
            name: "Position",
            table: "QuestionAssessments",
            nullable: false,
            defaultValue: 0);

        migrationBuilder.CreateIndex(
            name: "IX_QuestionAssessments_QuizId_Position",
            table: "QuestionAssessments",
            columns: new[] { "QuizId", "Position" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_QuestionAssessments_QuizId_Position",
            table: "QuestionAssessments");

        migrationBuilder.DropColumn(name: "DurationMs", table: "Videos");
        migrationBuilder.DropColumn(name: "ModelName", table: "QuizAssessments");
        migrationBuilder.DropColumn(name: "PromptVersion", table: "QuizAssessments");
        migrationBuilder.DropColumn(name: "Position", table: "QuestionAssessments");
    }
}
