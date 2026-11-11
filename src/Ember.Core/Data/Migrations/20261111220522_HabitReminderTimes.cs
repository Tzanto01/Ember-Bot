using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ember.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class HabitReminderTimes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<List<TimeOnly>>(
                name: "ReminderTimes",
                table: "Habits",
                type: "time without time zone[]",
                nullable: false,
                defaultValueSql: "'{}'");

            migrationBuilder.Sql("""UPDATE "Habits" SET "ReminderTimes" = ARRAY["ReminderTime"] WHERE "ReminderTime" IS NOT NULL;""");

            migrationBuilder.DropColumn(
                name: "ReminderTime",
                table: "Habits");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<TimeOnly>(
                name: "ReminderTime",
                table: "Habits",
                type: "time without time zone",
                nullable: true);

            migrationBuilder.Sql("""UPDATE "Habits" SET "ReminderTime" = "ReminderTimes"[1];""");

            migrationBuilder.DropColumn(
                name: "ReminderTimes",
                table: "Habits");
        }
    }
}
