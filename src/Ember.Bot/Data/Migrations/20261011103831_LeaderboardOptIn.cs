using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Ember.Bot.Data.Migrations
{
    /// <inheritdoc />
    public partial class LeaderboardOptIn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "LeaderboardOptOut",
                table: "Users",
                newName: "LeaderboardOptIn");

            // The old column meant "opted out" and defaulted to visible. Nobody has
            // consented to the opt-in leaderboard yet, so every existing user starts out.
            migrationBuilder.Sql("UPDATE \"Users\" SET \"LeaderboardOptIn\" = FALSE;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "LeaderboardOptIn",
                table: "Users",
                newName: "LeaderboardOptOut");

            migrationBuilder.Sql("UPDATE \"Users\" SET \"LeaderboardOptOut\" = NOT \"LeaderboardOptOut\";");
        }
    }
}
