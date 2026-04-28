using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ember.Bot.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFrequencyPauseLeaderboard : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "GraceDaysPerWeek",
                table: "Users",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "LeaderboardOptOut",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "FrequencyType",
                table: "Habits",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PausedUntil",
                table: "Habits",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WeeklyTarget",
                table: "Habits",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "GuildId",
                table: "HabitLogs",
                type: "bigint",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "GraceDaysPerWeek",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "LeaderboardOptOut",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "FrequencyType",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "PausedUntil",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "WeeklyTarget",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "GuildId",
                table: "HabitLogs");
        }
    }
}
