using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ember.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLanguageCalmModeAndHelps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CalmMode",
                table: "AspNetUsers",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Language",
                table: "AspNetUsers",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "en");

            migrationBuilder.CreateTable(
                name: "UserHelps",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Encrypted = table.Column<string>(type: "character varying(16384)", maxLength: 16384, nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserHelps", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_UserHelps_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserHelps");

            migrationBuilder.DropColumn(
                name: "CalmMode",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "Language",
                table: "AspNetUsers");
        }
    }
}
