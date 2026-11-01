using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Ember.Core.Data.Migrations
{
    /// <summary>
    /// Turns the Discord-keyed <c>Users</c> table into Identity's <c>AspNetUsers</c> with a <c>uuid</c> key.
    /// Hand-written: EF scaffolds a drop of <c>DiscordUserId</c> and a <c>bigint</c> to <c>uuid</c> cast, which loses
    /// the user mapping. Instead every user keeps their data through a new GUID, and the Discord ID moves to
    /// <c>AspNetUserLogins</c> (provider <c>Discord</c>, key = the ID as a decimal string). The migration runs in one
    /// transaction and aborts if any user, login or reference doesn't line up. Needs Postgres 13+ (<c>gen_random_uuid</c>).
    /// </summary>
    public partial class IdentityUsers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1. Detach the user references, then rename the table Identity expects.
            migrationBuilder.Sql("""
                ALTER TABLE "DayMarks" DROP CONSTRAINT "FK_DayMarks_Users_UserId";
                ALTER TABLE "Habits" DROP CONSTRAINT "FK_Habits_Users_UserId";
                ALTER TABLE "Users" RENAME TO "AspNetUsers";
                """);

            // 2. Identity's columns, filled for every existing (bot-only) user: a new GUID, a synthetic
            //    discord_{id} user name, and fresh security and concurrency stamps.
            migrationBuilder.Sql("""
                ALTER TABLE "AspNetUsers"
                    ADD "Id" uuid,
                    ADD "UserName" character varying(256),
                    ADD "NormalizedUserName" character varying(256),
                    ADD "Email" character varying(256),
                    ADD "NormalizedEmail" character varying(256),
                    ADD "EmailConfirmed" boolean NOT NULL DEFAULT FALSE,
                    ADD "PasswordHash" text,
                    ADD "SecurityStamp" text,
                    ADD "ConcurrencyStamp" text,
                    ADD "PhoneNumber" text,
                    ADD "PhoneNumberConfirmed" boolean NOT NULL DEFAULT FALSE,
                    ADD "TwoFactorEnabled" boolean NOT NULL DEFAULT FALSE,
                    ADD "LockoutEnd" timestamp with time zone,
                    ADD "LockoutEnabled" boolean NOT NULL DEFAULT FALSE,
                    ADD "AccessFailedCount" integer NOT NULL DEFAULT 0;

                UPDATE "AspNetUsers" SET
                    "Id" = gen_random_uuid(),
                    "UserName" = 'discord_' || "DiscordUserId",
                    "NormalizedUserName" = 'DISCORD_' || "DiscordUserId",
                    "SecurityStamp" = upper(replace(gen_random_uuid()::text, '-', '')),
                    "ConcurrencyStamp" = gen_random_uuid()::text;

                ALTER TABLE "AspNetUsers"
                    ALTER "EmailConfirmed" DROP DEFAULT,
                    ALTER "PhoneNumberConfirmed" DROP DEFAULT,
                    ALTER "TwoFactorEnabled" DROP DEFAULT,
                    ALTER "LockoutEnabled" DROP DEFAULT,
                    ALTER "AccessFailedCount" DROP DEFAULT,
                    ALTER "Id" SET NOT NULL,
                    DROP CONSTRAINT "PK_Users",
                    ADD CONSTRAINT "PK_AspNetUsers" PRIMARY KEY ("Id");
                """);

            migrationBuilder.CreateTable(
                name: "AspNetUserClaims",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClaimType = table.Column<string>(type: "text", nullable: true),
                    ClaimValue = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AspNetUserClaims", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AspNetUserClaims_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AspNetUserLogins",
                columns: table => new
                {
                    LoginProvider = table.Column<string>(type: "text", nullable: false),
                    ProviderKey = table.Column<string>(type: "text", nullable: false),
                    ProviderDisplayName = table.Column<string>(type: "text", nullable: true),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AspNetUserLogins", x => new { x.LoginProvider, x.ProviderKey });
                    table.ForeignKey(
                        name: "FK_AspNetUserLogins_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AspNetUserTokens",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LoginProvider = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Value = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AspNetUserTokens", x => new { x.UserId, x.LoginProvider, x.Name });
                    table.ForeignKey(
                        name: "FK_AspNetUserTokens_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // 3. One Discord login per existing user, and the new user ID on every row that points at a user.
            migrationBuilder.Sql("""
                INSERT INTO "AspNetUserLogins" ("LoginProvider", "ProviderKey", "ProviderDisplayName", "UserId")
                SELECT 'Discord', "DiscordUserId"::text, 'Discord', "Id" FROM "AspNetUsers";

                ALTER TABLE "Habits" ADD "UserGuid" uuid;
                UPDATE "Habits" h SET "UserGuid" = u."Id" FROM "AspNetUsers" u WHERE u."DiscordUserId" = h."UserId";

                ALTER TABLE "DayMarks" ADD "UserGuid" uuid;
                UPDATE "DayMarks" m SET "UserGuid" = u."Id" FROM "AspNetUsers" u WHERE u."DiscordUserId" = m."UserId";
                """);

            // 4. Verify before anything is dropped. A failure rolls back the whole migration.
            migrationBuilder.Sql("""
                DO $$
                DECLARE
                    users bigint := (SELECT count(*) FROM "AspNetUsers");
                    logins bigint := (SELECT count(*) FROM "AspNetUserLogins" l JOIN "AspNetUsers" u
                                      ON u."Id" = l."UserId" AND l."ProviderKey" = u."DiscordUserId"::text);
                    habits bigint := (SELECT count(*) FROM "Habits" WHERE "UserGuid" IS NULL);
                    marks bigint := (SELECT count(*) FROM "DayMarks" WHERE "UserGuid" IS NULL);
                BEGIN
                    IF logins <> users THEN
                        RAISE EXCEPTION 'IdentityUsers: % users but % matching Discord logins', users, logins;
                    END IF;
                    IF habits > 0 OR marks > 0 THEN
                        RAISE EXCEPTION 'IdentityUsers: % habits and % day marks without a user', habits, marks;
                    END IF;
                END $$;
                """);

            // 5. Swap the references to the new key and drop the Discord ID from the users table.
            migrationBuilder.Sql("""
                DROP INDEX "IX_Habits_UserId";
                ALTER TABLE "Habits" DROP COLUMN "UserId";
                ALTER TABLE "Habits" RENAME COLUMN "UserGuid" TO "UserId";
                ALTER TABLE "Habits" ALTER "UserId" SET NOT NULL;
                CREATE INDEX "IX_Habits_UserId" ON "Habits" ("UserId");
                ALTER TABLE "Habits" ADD CONSTRAINT "FK_Habits_AspNetUsers_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE;

                DROP INDEX "IX_DayMarks_UserId_Date_Kind";
                ALTER TABLE "DayMarks" DROP COLUMN "UserId";
                ALTER TABLE "DayMarks" RENAME COLUMN "UserGuid" TO "UserId";
                ALTER TABLE "DayMarks" ALTER "UserId" SET NOT NULL;
                CREATE UNIQUE INDEX "IX_DayMarks_UserId_Date_Kind" ON "DayMarks" ("UserId", "Date", "Kind");
                ALTER TABLE "DayMarks" ADD CONSTRAINT "FK_DayMarks_AspNetUsers_UserId"
                    FOREIGN KEY ("UserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE;

                ALTER TABLE "AspNetUsers" DROP COLUMN "DiscordUserId";
                """);

            migrationBuilder.CreateIndex(
                name: "EmailIndex",
                table: "AspNetUsers",
                column: "NormalizedEmail");

            migrationBuilder.CreateIndex(
                name: "UserNameIndex",
                table: "AspNetUsers",
                column: "NormalizedUserName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AspNetUserClaims_UserId",
                table: "AspNetUserClaims",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_AspNetUserLogins_UserId",
                table: "AspNetUserLogins",
                column: "UserId");
        }

        /// <summary>
        /// Not supported. Once a user exists only as an Identity user (an email account, or a bot user created after
        /// this migration), there is no Discord ID to go back to. Roll back by restoring the dump taken before the deploy.
        /// </summary>
        protected override void Down(MigrationBuilder migrationBuilder)
            => throw new NotSupportedException("IdentityUsers can't be reverted. Restore the pg_dump taken before this migration ran.");
    }
}
