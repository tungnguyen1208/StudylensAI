using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudyLens.Api.Infrastructure.Persistence.Migrations;

[DbContext(typeof(StudyLensDbContext))]
[Migration("20261015130000_ScopeQuotaReservationIdempotencyByDay")]
public partial class ScopeQuotaReservationIdempotencyByDay : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_QuotaReservations_UserId_ResourceType_OperationKey",
            table: "QuotaReservations");

        migrationBuilder.CreateIndex(
            name: "IX_QuotaReservations_UserId_QuotaDateUtc_ResourceType_OperationKey",
            table: "QuotaReservations",
            columns: new[] { "UserId", "QuotaDateUtc", "ResourceType", "OperationKey" },
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_QuotaReservations_UserId_QuotaDateUtc_ResourceType_OperationKey",
            table: "QuotaReservations");

        migrationBuilder.CreateIndex(
            name: "IX_QuotaReservations_UserId_ResourceType_OperationKey",
            table: "QuotaReservations",
            columns: new[] { "UserId", "ResourceType", "OperationKey" },
            unique: true);
    }
}
