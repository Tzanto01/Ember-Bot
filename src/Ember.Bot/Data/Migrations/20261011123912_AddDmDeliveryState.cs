using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ember.Bot.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDmDeliveryState : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DmFailureCount",
                table: "Users",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "DmPauseNoticeSentAt",
                table: "Users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DmRemindersPausedAt",
                table: "Users",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DmFailureCount",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "DmPauseNoticeSentAt",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "DmRemindersPausedAt",
                table: "Users");
        }
    }
}
