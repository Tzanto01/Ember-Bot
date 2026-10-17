using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ember.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddHealthDataConsent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ConsentPolicyVersion",
                table: "Users",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ConsentPromptedOn",
                table: "Users",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "HealthDataConsentAt",
                table: "Users",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ConsentPolicyVersion",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "ConsentPromptedOn",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "HealthDataConsentAt",
                table: "Users");
        }
    }
}
