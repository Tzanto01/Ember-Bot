using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ember.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class PushSubscriptionSession : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SessionId",
                table: "PushSubscriptions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_PushSubscriptions_SessionId",
                table: "PushSubscriptions",
                column: "SessionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PushSubscriptions_SessionId",
                table: "PushSubscriptions");

            migrationBuilder.DropColumn(
                name: "SessionId",
                table: "PushSubscriptions");
        }
    }
}
