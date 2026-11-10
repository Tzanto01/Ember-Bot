using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Ember.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemindersV18 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "SecondReminderUtc",
                table: "Routines",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SecondReminderUtc",
                table: "Habits",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SecondReminderMinutes",
                table: "AspNetUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "ReminderMessages",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    HabitId = table.Column<int>(type: "integer", nullable: true),
                    RoutineId = table.Column<int>(type: "integer", nullable: true),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    ChannelId = table.Column<decimal>(type: "numeric(20,0)", nullable: false),
                    MessageId = table.Column<decimal>(type: "numeric(20,0)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReminderMessages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReminderMessages_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ReminderMessages_Habits_HabitId",
                        column: x => x.HabitId,
                        principalTable: "Habits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ReminderMessages_Routines_RoutineId",
                        column: x => x.RoutineId,
                        principalTable: "Routines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Routines_SecondReminderUtc",
                table: "Routines",
                column: "SecondReminderUtc");

            migrationBuilder.CreateIndex(
                name: "IX_Habits_SecondReminderUtc",
                table: "Habits",
                column: "SecondReminderUtc");

            migrationBuilder.CreateIndex(
                name: "IX_ReminderMessages_HabitId",
                table: "ReminderMessages",
                column: "HabitId");

            migrationBuilder.CreateIndex(
                name: "IX_ReminderMessages_MessageId",
                table: "ReminderMessages",
                column: "MessageId");

            migrationBuilder.CreateIndex(
                name: "IX_ReminderMessages_RoutineId",
                table: "ReminderMessages",
                column: "RoutineId");

            migrationBuilder.CreateIndex(
                name: "IX_ReminderMessages_UserId",
                table: "ReminderMessages",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReminderMessages");

            migrationBuilder.DropIndex(
                name: "IX_Routines_SecondReminderUtc",
                table: "Routines");

            migrationBuilder.DropIndex(
                name: "IX_Habits_SecondReminderUtc",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "SecondReminderUtc",
                table: "Routines");

            migrationBuilder.DropColumn(
                name: "SecondReminderUtc",
                table: "Habits");

            migrationBuilder.DropColumn(
                name: "SecondReminderMinutes",
                table: "AspNetUsers");
        }
    }
}
