using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudyLens.Api.Infrastructure.Persistence.Migrations;

[DbContext(typeof(StudyLensDbContext))]
[Migration("20260923120000_AddTranscriptCaptureTimeline")]
public partial class AddTranscriptCaptureTimeline : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "TranscriptCaptures",
            columns: table => new
            {
                TranscriptCaptureId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                YoutubeVideoId = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                Language = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
                Source = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                Status = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
                Version = table.Column<int>(type: "INTEGER", nullable: false),
                CreateIdempotencyKey = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                CreatedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
            }, constraints: table => table.PrimaryKey("PK_TranscriptCaptures", item => item.TranscriptCaptureId));
        migrationBuilder.CreateTable(
            name: "TranscriptCaptureCues",
            columns: table => new
            {
                TranscriptCueId = table.Column<string>(type: "TEXT", nullable: false),
                TranscriptCaptureId = table.Column<string>(type: "TEXT", nullable: false),
                ChunkIndex = table.Column<int>(type: "INTEGER", nullable: false),
                StartMs = table.Column<long>(type: "INTEGER", nullable: false),
                EndMs = table.Column<long>(type: "INTEGER", nullable: false),
                Text = table.Column<string>(type: "TEXT", nullable: false),
            }, constraints: table =>
            {
                table.PrimaryKey("PK_TranscriptCaptureCues", item => item.TranscriptCueId);
                table.ForeignKey("FK_TranscriptCaptureCues_TranscriptCaptures_TranscriptCaptureId", item => item.TranscriptCaptureId, "TranscriptCaptures", "TranscriptCaptureId", onDelete: ReferentialAction.Cascade);
            });
        migrationBuilder.CreateTable(
            name: "TranscriptAudioChunks",
            columns: table => new
            {
                TranscriptAudioChunkId = table.Column<string>(type: "TEXT", nullable: false),
                TranscriptCaptureId = table.Column<string>(type: "TEXT", nullable: false),
                IdempotencyKey = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                PayloadFingerprint = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                ChunkIndex = table.Column<int>(type: "INTEGER", nullable: false),
                StartMs = table.Column<long>(type: "INTEGER", nullable: false),
                EndMs = table.Column<long>(type: "INTEGER", nullable: false),
                AcceptedAtUtc = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
            }, constraints: table =>
            {
                table.PrimaryKey("PK_TranscriptAudioChunks", item => item.TranscriptAudioChunkId);
                table.ForeignKey("FK_TranscriptAudioChunks_TranscriptCaptures_TranscriptCaptureId", item => item.TranscriptCaptureId, "TranscriptCaptures", "TranscriptCaptureId", onDelete: ReferentialAction.Cascade);
            });
        migrationBuilder.CreateIndex(name: "IX_TranscriptCaptures_CreateIdempotencyKey", table: "TranscriptCaptures", column: "CreateIdempotencyKey", unique: true);
        migrationBuilder.CreateIndex(name: "IX_TranscriptCaptureCues_TranscriptCaptureId_ChunkIndex", table: "TranscriptCaptureCues", columns: new[] { "TranscriptCaptureId", "ChunkIndex" });
        migrationBuilder.CreateIndex(name: "IX_TranscriptAudioChunks_IdempotencyKey", table: "TranscriptAudioChunks", column: "IdempotencyKey", unique: true);
        migrationBuilder.CreateIndex(name: "IX_TranscriptAudioChunks_TranscriptCaptureId_ChunkIndex", table: "TranscriptAudioChunks", columns: new[] { "TranscriptCaptureId", "ChunkIndex" }, unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "TranscriptAudioChunks");
        migrationBuilder.DropTable(name: "TranscriptCaptureCues");
        migrationBuilder.DropTable(name: "TranscriptCaptures");
    }
}
