using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Ember.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class FeaturesV16 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LeaderboardOptIn",
                table: "AspNetUsers");

            migrationBuilder.AddColumn<int>(
                name: "Days",
                table: "Habits",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RoutineId",
                table: "Habits",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RoutinePosition",
                table: "Habits",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TimesPerDay",
                table: "Habits",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "Count",
                table: "HabitLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql("UPDATE \"HabitLogs\" SET \"Count\" = 1 WHERE \"Completed\";");

            migrationBuilder.CreateTable(
                name: "DayNotes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Text = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Mood = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    CipherVersion = table.Column<int>(type: "integer", nullable: true),
                    CipherIv = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CipherText = table.Column<string>(type: "character varying(16384)", maxLength: 16384, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DayNotes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DayNotes_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "JournalKeys",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    PassphraseSalt = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    PassphraseIterations = table.Column<int>(type: "integer", nullable: false),
                    PassphraseIv = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    PassphraseWrapped = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    RecoverySalt = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    RecoveryIv = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    RecoveryWrapped = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_JournalKeys", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_JournalKeys_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Moods",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Label = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    Emoji = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    Archived = table.Column<bool>(type: "boolean", nullable: false),
                    CipherVersion = table.Column<int>(type: "integer", nullable: true),
                    CipherIv = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CipherText = table.Column<string>(type: "character varying(16384)", maxLength: 16384, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Moods", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Moods_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Routines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ReminderTime = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    NextReminderUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReminderChannels = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Routines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Routines_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Habits_RoutineId",
                table: "Habits",
                column: "RoutineId");

            migrationBuilder.CreateIndex(
                name: "IX_DayNotes_UserId_Date",
                table: "DayNotes",
                columns: new[] { "UserId", "Date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Moods_UserId",
                table: "Moods",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_Routines_NextReminderUtc",
                table: "Routines",
                column: "NextReminderUtc");

            migrationBuilder.CreateIndex(
                name: "IX_Routines_UserId",
                table: "Routines",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Habits_Routines_RoutineId",
                table: "Habits",
                column: "RoutineId",
                principalTable: "Routines",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Habits_Routines_RoutineId",
                table: "Habits");

            migrationBuilder.DropTable(
                name: "DayNotes");

            migrationBuilder.DropTable(
                name: "JournalKeys");

            migrationBuilder.DropTable(
                name: "Moods");

            migrationBuilder.DropTable(
                name: "Routines");

            migrationBuilder.DropIndex(
                name: "IX_Habits_RoutineId",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "Days",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "RoutineId",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "RoutinePosition",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "TimesPerDay",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "Count",
                table: "HabitLogs");

            migrationBuilder.AddColumn<bool>(
                name: "LeaderboardOptIn",
                table: "AspNetUsers",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }
    }
}
