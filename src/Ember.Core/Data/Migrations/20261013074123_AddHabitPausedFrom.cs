using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ember.Core.Data.Migrations
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

            migrationBuilder.Sql(
                "UPDATE \"Habits\" SET \"PausedFrom\" = CASE WHEN \"PausedUntil\" >= CURRENT_DATE THEN CURRENT_DATE ELSE \"PausedUntil\" + 1 END " +
                "WHERE \"PausedUntil\" IS NOT NULL;");
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
