using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ember.Bot.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNextReminderUtc : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "NextReminderUtc",
                table: "Habits",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Habits_NextReminderUtc",
                table: "Habits",
                column: "NextReminderUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Habits_NextReminderUtc",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "NextReminderUtc",
                table: "Habits");
        }
    }
}
