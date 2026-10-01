using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudyLens.Api.Infrastructure.Persistence.Migrations;

[DbContext(typeof(StudyLensDbContext))]
[Migration("20261001100000_AddVideoHistoryLookupIndexes")]
public partial class AddVideoHistoryLookupIndexes : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateIndex("IX_QuizAssessments_YoutubeVideoId", "QuizAssessments", "YoutubeVideoId");
        migrationBuilder.CreateIndex("IX_QuizAttempts_SessionId", "QuizAttempts", "SessionId");
        migrationBuilder.CreateIndex("IX_AttemptAnswers_YoutubeVideoId", "AttemptAnswers", "YoutubeVideoId");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex("IX_QuizAssessments_YoutubeVideoId", "QuizAssessments");
        migrationBuilder.DropIndex("IX_QuizAttempts_SessionId", "QuizAttempts");
        migrationBuilder.DropIndex("IX_AttemptAnswers_YoutubeVideoId", "AttemptAnswers");
    }
}
