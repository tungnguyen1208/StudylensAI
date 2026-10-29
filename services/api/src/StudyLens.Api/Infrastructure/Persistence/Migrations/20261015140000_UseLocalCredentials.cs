using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudyLens.Api.Infrastructure.Persistence.Migrations;

[DbContext(typeof(StudyLensDbContext))]
[Migration("20261015140000_UseLocalCredentials")]
public partial class UseLocalCredentials : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable("AuthTickets");
        migrationBuilder.DropTable("OAuthLoginStates");
        migrationBuilder.AlterColumn<string>("GoogleSubject", "AppUsers", maxLength: 128, nullable: true,
            oldClrType: typeof(string), oldType: "character varying(128)", oldMaxLength: 128);
        migrationBuilder.AlterColumn<string>("Email", "AppUsers", maxLength: 320, nullable: true,
            oldClrType: typeof(string), oldType: "character varying(320)", oldMaxLength: 320);
        migrationBuilder.CreateTable("LocalCredentials", table => new
        {
            UserId = table.Column<string>(maxLength: 64, nullable: false),
            Username = table.Column<string>(maxLength: 32, nullable: false),
            NormalizedUsername = table.Column<string>(maxLength: 32, nullable: false),
            PasswordHash = table.Column<string>(maxLength: 512, nullable: false),
            FailedAccessAttempts = table.Column<int>(nullable: false),
            LockoutEndUtc = table.Column<DateTimeOffset>(nullable: true),
            PasswordChangedAtUtc = table.Column<DateTimeOffset>(nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("PK_LocalCredentials", item => item.UserId);
            table.ForeignKey("FK_LocalCredentials_AppUsers_UserId", item => item.UserId, "AppUsers", "UserId",
                onDelete: ReferentialAction.Cascade);
        });
        migrationBuilder.CreateIndex("IX_LocalCredentials_NormalizedUsername", "LocalCredentials", "NormalizedUsername", unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable("LocalCredentials");
        if (ActiveProvider.Contains("Npgsql", StringComparison.OrdinalIgnoreCase))
            migrationBuilder.Sql("UPDATE \"AppUsers\" SET \"GoogleSubject\" = 'local:' || \"UserId\", \"Email\" = COALESCE(\"Email\", '') WHERE \"GoogleSubject\" IS NULL OR \"Email\" IS NULL;");
        else
            migrationBuilder.Sql("UPDATE \"AppUsers\" SET \"GoogleSubject\" = 'local:' || \"UserId\", \"Email\" = COALESCE(\"Email\", '') WHERE \"GoogleSubject\" IS NULL OR \"Email\" IS NULL;");
        migrationBuilder.AlterColumn<string>("GoogleSubject", "AppUsers", maxLength: 128, nullable: false,
            oldClrType: typeof(string), oldType: "character varying(128)", oldMaxLength: 128, oldNullable: true);
        migrationBuilder.AlterColumn<string>("Email", "AppUsers", maxLength: 320, nullable: false,
            oldClrType: typeof(string), oldType: "character varying(320)", oldMaxLength: 320, oldNullable: true);
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
            table.ForeignKey("FK_AuthTickets_AppUsers_UserId", item => item.UserId, "AppUsers", "UserId",
                onDelete: ReferentialAction.Cascade);
        });
        migrationBuilder.CreateIndex("IX_AuthTickets_UserId", "AuthTickets", "UserId");
    }
}
