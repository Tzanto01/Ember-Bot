using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ember.Bot.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddHabitPausedFrom : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "PausedFrom",
                table: "Habits",
                type: "date",
                nullable: true);

            migrationBuilder.Sql("UPDATE \"Habits\" SET \"PausedFrom\" = CURRENT_DATE WHERE \"PausedUntil\" >= CURRENT_DATE;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PausedFrom",
                table: "Habits");
        }
    }
}
