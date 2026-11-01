using Ember.Bot;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Ember.Tests;

/// <summary>The IdentityUsers migration against a database shaped like production before it.</summary>
[Collection("Postgres")]
public class PostgresIdentityMigrationTests(PostgresFixture postgres)
{
    private const string LastMigrationBefore = "20261013074123_AddHabitPausedFrom";

    // Two Discord users with data, one without habits, IDs past JavaScript's safe integer range like real snowflakes.
    private const long Alice = 712345678901234567;
    private const long Bob = 812345678901234567;
    private const long Carol = 912345678901234567;

    private static readonly string ProductionShapedData = $"""
        INSERT INTO "Users" ("DiscordUserId", "Timezone", "GraceDaysPerWeek", "LeaderboardOptIn", "DmFailureCount",
                             "HealthDataConsentAt", "ConsentPolicyVersion")
        VALUES ({Alice}, 'Europe/Berlin', 2, TRUE, 0, '2026-10-14 08:00:00', '2026-10'),
               ({Bob}, 'Asia/Tokyo', 1, FALSE, 3, NULL, NULL),
               ({Carol}, 'UTC', 1, FALSE, 0, NULL, NULL);
        INSERT INTO "Habits" ("Id", "UserId", "Name", "ReminderTime", "CreatedAt", "FrequencyType", "WeeklyTarget", "PausedFrom", "PausedUntil")
        VALUES (1, {Alice}, 'Stretch', '09:00', '2026-09-01 10:00:00', 0, NULL, NULL, NULL),
               (2, {Alice}, 'Read', NULL, '2026-09-02 10:00:00', 1, 3, '2026-10-10', '2026-10-20'),
               (3, {Bob}, 'Walk', NULL, '2026-09-03 10:00:00', 0, NULL, NULL, NULL);
        INSERT INTO "HabitLogs" ("HabitId", "Date", "Completed", "GuildId")
        VALUES (1, '2026-10-01', TRUE, 99), (1, '2026-10-02', FALSE, NULL), (2, '2026-10-03', TRUE, NULL), (3, '2026-10-01', TRUE, 99);
        INSERT INTO "DayMarks" ("UserId", "Date", "Kind") VALUES ({Alice}, '2026-10-05', 0), ({Bob}, '2026-10-05', 0);
        """;

    private static EmberDbContext Context(string connectionString)
        => new(new DbContextOptionsBuilder<EmberDbContext>().UseNpgsql(connectionString).Options);

    private async Task<string> SeededDatabaseAsync()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        await using var db = Context(connectionString);
        await db.GetService<IMigrator>().MigrateAsync(LastMigrationBefore);
        await db.Database.ExecuteSqlRawAsync(ProductionShapedData);
        return connectionString;
    }

    [DockerFact]
    public async Task EveryUserKeepsTheirSettingsHabitsLogsAndLowDays_UnderTheirDiscordLogin()
    {
        var connectionString = await SeededDatabaseAsync();
        await using (var db = Context(connectionString))
            await db.GetService<IMigrator>().MigrateAsync();

        await using var check = Context(connectionString);
        var users = await check.Users.AsNoTracking()
            .Include(u => u.Logins).Include(u => u.Habits).ThenInclude(h => h.Logs).Include(u => u.DayMarks)
            .AsSplitQuery().ToListAsync();

        users.Should().HaveCount(3);
        users.Select(u => u.Id).Should().OnlyHaveUniqueItems().And.NotContain(Guid.Empty);
        users.Should().OnlyContain(u => u.Logins.Count == 1 && u.Logins.Single().LoginProvider == DiscordLogin.Provider);
        users.Should().OnlyContain(u => u.UserName == "discord_" + u.Logins.Single().ProviderKey
            && u.NormalizedUserName == "DISCORD_" + u.Logins.Single().ProviderKey
            && !string.IsNullOrEmpty(u.SecurityStamp) && !string.IsNullOrEmpty(u.ConcurrencyStamp)
            && u.Email == null && u.PasswordHash == null);

        var alice = users.Single(u => u.DiscordId() == Alice);
        alice.Timezone.Should().Be("Europe/Berlin");
        alice.GraceDaysPerWeek.Should().Be(2);
        alice.LeaderboardOptIn.Should().BeTrue();
        alice.ConsentPolicyVersion.Should().Be("2026-10");
        alice.Habits.Select(h => h.Name).Should().BeEquivalentTo("Stretch", "Read");
        alice.Habits.Single(h => h.Name == "Stretch").Logs.Should().HaveCount(2).And.Contain(l => l.GuildId == 99 && l.Completed);
        var read = alice.Habits.Single(h => h.Name == "Read");
        (read.PausedFrom, read.PausedUntil, read.WeeklyTarget).Should().Be((new DateOnly(2026, 10, 10), new DateOnly(2026, 10, 20), 3));
        alice.DayMarks.Should().ContainSingle(m => m.Date == new DateOnly(2026, 10, 5));

        var bob = users.Single(u => u.DiscordId() == Bob);
        bob.Timezone.Should().Be("Asia/Tokyo");
        bob.DmFailureCount.Should().Be(3);
        bob.Habits.Should().ContainSingle(h => h.Name == "Walk").Which.Logs.Should().ContainSingle();
        bob.DayMarks.Should().ContainSingle();

        var carol = users.Single(u => u.DiscordId() == Carol);
        carol.Habits.Should().BeEmpty();
        carol.DayMarks.Should().BeEmpty();

        (await check.HabitLogs.CountAsync()).Should().Be(4);
    }

    [DockerFact]
    public async Task MigratedDiscordUser_SeesTheirHabitsThroughTheBot_AndNewUsersCanStillBeCreated()
    {
        var connectionString = await SeededDatabaseAsync();
        using var host = AppHost.CreateHostBuilder([], new EmberHostOptions
        {
            IncludeDiscordGateway = false,
            ConfigureDbContext = (options, _) => options.UseNpgsql(connectionString)
        }).Build();
        await AppHost.InitializeAsync(host);

        await using var scope = host.Services.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<HabitService>();

        (await service.GetHabitsAsync((ulong)Alice)).Select(h => h.Name).Should().Equal("Stretch", "Read");
        (await service.HasHealthDataConsentAsync((ulong)Alice)).Should().BeTrue();
        (await service.CheckInAsync((ulong)Bob, 3, new DateOnly(2026, 10, 4), completed: true)).Should().Be(DayEditResult.Saved);
        (await service.CheckInAsync((ulong)Bob, 1, new DateOnly(2026, 10, 4), completed: true)).Should().Be(DayEditResult.HabitNotFound, "habit 1 is Alice's");

        var dave = await service.ResolveOrCreateDiscordUserAsync(1);
        dave.Should().NotBe(Guid.Empty);
        (await service.ResolveOrCreateDiscordUserAsync((ulong)Carol)).Should().Be(await service.FindDiscordUserAsync((ulong)Carol));
    }

    [DockerFact]
    public async Task MigratedSchema_MatchesTheModel_ColumnForColumnAndIndexForIndex()
    {
        var migrated = await SeededDatabaseAsync();
        await using (var db = Context(migrated))
        {
            await db.GetService<IMigrator>().MigrateAsync();
            db.Database.HasPendingModelChanges().Should().BeFalse();
        }

        var created = await postgres.CreateDatabaseAsync();
        await using (var db = Context(created))
            await db.Database.EnsureCreatedAsync();

        var schema = await SchemaAsync(migrated);
        schema.Should().Contain(r => r.Contains("PK_AspNetUserLogins")).And.Contain(r => r.Contains("FK_Habits_AspNetUsers_UserId"));
        schema.Should().BeEquivalentTo(await SchemaAsync(created));
    }

    [DockerFact]
    public async Task AReferenceWithoutAUser_AbortsTheWholeMigration_AndLeavesTheOldSchema()
    {
        var connectionString = await SeededDatabaseAsync();
        await using var db = Context(connectionString);
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE "Habits" DROP CONSTRAINT "FK_Habits_Users_UserId";
            INSERT INTO "Habits" ("Id", "UserId", "Name", "CreatedAt", "FrequencyType") VALUES (100, 424242, 'Orphan', now(), 0);
            ALTER TABLE "Habits" ADD CONSTRAINT "FK_Habits_Users_UserId"
                FOREIGN KEY ("UserId") REFERENCES "Users" ("DiscordUserId") ON DELETE CASCADE NOT VALID;
            """);

        var migrate = () => db.GetService<IMigrator>().MigrateAsync();

        (await migrate.Should().ThrowAsync<PostgresException>()).Which.MessageText.Should().Contain("without a user");
        (await db.Database.GetAppliedMigrationsAsync()).Last().Should().Be(LastMigrationBefore);
        (await db.Database.SqlQueryRaw<long>("""SELECT count(*) AS "Value" FROM "Users" """).SingleAsync()).Should().Be(3);
    }

    /// <summary>
    /// Columns, indexes and constraints of the public schema, without EF's migrations history table. Column defaults
    /// are left out: EF's earlier AddColumn migrations leave a DEFAULT behind that the model (and EnsureCreated) has not.
    /// </summary>
    private static async Task<List<string>> SchemaAsync(string connectionString)
    {
        const string sql = """
            SELECT 'column ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' '
                   || coalesce(character_maximum_length::text, '') || ' ' || is_identity
            FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '__EFMigrationsHistory'
            UNION ALL
            SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename <> '__EFMigrationsHistory'
            UNION ALL
            SELECT 'constraint ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
            FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text <> '"__EFMigrationsHistory"'
            """;
        var rows = new List<string>();
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) rows.Add(reader.GetString(0));
        return rows;
    }
}
