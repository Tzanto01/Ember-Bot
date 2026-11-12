using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Ember.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class MultiDeviceReminders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<List<string>>(
                name: "ReminderExclusions",
                table: "Routines",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'");

            migrationBuilder.AddColumn<bool>(
                name: "Enabled",
                table: "PushSubscriptions",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "Label",
                table: "PushSubscriptions",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<List<string>>(
                name: "ReminderExclusions",
                table: "Habits",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'");

            migrationBuilder.AddColumn<bool>(
                name: "DiscordReminders",
                table: "AspNetUsers",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DiscordRemindersAskedAt",
                table: "AspNetUsers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PushReminders",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    HabitId = table.Column<int>(type: "integer", nullable: true),
                    RoutineId = table.Column<int>(type: "integer", nullable: true),
                    Date = table.Column<DateOnly>(type: "date", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PushReminders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PushReminders_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PushReminders_Habits_HabitId",
                        column: x => x.HabitId,
                        principalTable: "Habits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PushReminders_Routines_RoutineId",
                        column: x => x.RoutineId,
                        principalTable: "Routines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ReminderPhones",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    InstallId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Label = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReminderPhones", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReminderPhones_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PushReminders_HabitId",
                table: "PushReminders",
                column: "HabitId");

            migrationBuilder.CreateIndex(
                name: "IX_PushReminders_RoutineId",
                table: "PushReminders",
                column: "RoutineId");

            migrationBuilder.CreateIndex(
                name: "IX_PushReminders_UserId",
                table: "PushReminders",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_ReminderPhones_InstallId",
                table: "ReminderPhones",
                column: "InstallId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReminderPhones_SessionId",
                table: "ReminderPhones",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_ReminderPhones_UserId",
                table: "ReminderPhones",
                column: "UserId");

            migrationBuilder.Sql("""
                UPDATE "AspNetUsers" u SET "DiscordReminders" = TRUE
                WHERE EXISTS (SELECT 1 FROM "AspNetUserLogins" l WHERE l."UserId" = u."Id" AND l."LoginProvider" = 'Discord')
                  AND (EXISTS (SELECT 1 FROM "Habits" h WHERE h."UserId" = u."Id" AND (h."ReminderChannels" & 1) <> 0
                               AND cardinality(h."ReminderTimes") > 0)
                       OR EXISTS (SELECT 1 FROM "Routines" r WHERE r."UserId" = u."Id" AND (r."ReminderChannels" & 1) <> 0
                                  AND r."ReminderTime" IS NOT NULL));
                """);

            migrationBuilder.DropColumn(
                name: "ReminderChannels",
                table: "Routines");

            migrationBuilder.DropColumn(
                name: "ReminderChannels",
                table: "Habits");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ReminderChannels",
                table: "Routines",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "ReminderChannels",
                table: "Habits",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql("""
                UPDATE "Habits" h SET "ReminderChannels" = CASE
                    WHEN u."DiscordReminders" IS TRUE AND NOT ('discord' = ANY(h."ReminderExclusions")) THEN 7 ELSE 6 END
                FROM "AspNetUsers" u WHERE u."Id" = h."UserId";
                UPDATE "Routines" r SET "ReminderChannels" = CASE
                    WHEN u."DiscordReminders" IS TRUE AND NOT ('discord' = ANY(r."ReminderExclusions")) THEN 7 ELSE 6 END
                FROM "AspNetUsers" u WHERE u."Id" = r."UserId";
                """);

            migrationBuilder.DropTable(
                name: "PushReminders");

            migrationBuilder.DropTable(
                name: "ReminderPhones");

            migrationBuilder.DropColumn(
                name: "ReminderExclusions",
                table: "Routines");

            migrationBuilder.DropColumn(
                name: "Enabled",
                table: "PushSubscriptions");

            migrationBuilder.DropColumn(
                name: "Label",
                table: "PushSubscriptions");

            migrationBuilder.DropColumn(
                name: "ReminderExclusions",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "DiscordReminders",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "DiscordRemindersAskedAt",
                table: "AspNetUsers");
        }
    }
}
