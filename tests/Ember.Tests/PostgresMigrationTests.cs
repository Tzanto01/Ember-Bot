using Ember.Bot;
using Ember.Bot.Data;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Postgres")]
public class PostgresMigrationTests(PostgresFixture postgres)
{
    [DockerFact]
    public async Task InitializeAsync_AppliesAllMigrationsAndMatchesModel()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        using var host = AppHost.CreateHostBuilder([], new EmberHostOptions
        {
            IncludeDiscordGateway = false,
            ConfigureDbContext = (options, _) => options.UseNpgsql(connectionString)
        }).Build();

        await AppHost.InitializeAsync(host);

        int habitId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();
            (await db.Database.GetPendingMigrationsAsync()).Should().BeEmpty();
            db.Database.HasPendingModelChanges().Should().BeFalse();

            var service = scope.ServiceProvider.GetRequiredService<HabitService>();
            var habit = await service.AddHabitAsync(4242, "Stretch", new TimeOnly(7, 30));
            habitId = habit.Id;
            (await service.CheckInAsync(4242, habitId, completed: true, guildId: 99)).Should().NotBeNull();
        }

        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();
            var stored = await db.Habits.Include(h => h.User).Include(h => h.Logs).SingleAsync(h => h.Id == habitId);

            stored.User.DiscordUserId.Should().Be(4242);
            stored.Name.Should().Be("Stretch");
            stored.ReminderTime.Should().Be(new TimeOnly(7, 30));
            stored.Logs.Should().ContainSingle(l => l.Completed && l.GuildId == 99);
        }
    }

    [DockerFact]
    public async Task LeaderboardOptInMigration_LeavesEveryExistingUserNotOptedIn()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        var options = new DbContextOptionsBuilder<EmberDbContext>().UseNpgsql(connectionString).Options;
        await using var db = new EmberDbContext(options);
        var migrator = db.GetService<IMigrator>();

        await migrator.MigrateAsync("20260428021004_AddFrequencyPauseLeaderboard");
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"Users\" (\"DiscordUserId\", \"Timezone\", \"GraceDaysPerWeek\", \"LeaderboardOptOut\") " +
            "VALUES (1, 'UTC', 1, FALSE), (2, 'UTC', 1, TRUE)");

        await migrator.MigrateAsync();

        var users = await db.Users.AsNoTracking().ToListAsync();
        users.Should().HaveCount(2).And.OnlyContain(u => !u.LeaderboardOptIn);
    }

    [DockerFact]
    public async Task UpgradingAnExistingDatabase_FillsNextReminderForHabitsWithAReminder()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        var options = new DbContextOptionsBuilder<EmberDbContext>().UseNpgsql(connectionString).Options;
        await using (var db = new EmberDbContext(options))
        {
            await db.GetService<IMigrator>().MigrateAsync("20260428021004_AddFrequencyPauseLeaderboard");
            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO \"Users\" (\"DiscordUserId\", \"Timezone\", \"GraceDaysPerWeek\", \"LeaderboardOptOut\") VALUES (7, 'Asia/Tokyo', 1, FALSE);" +
                "INSERT INTO \"Habits\" (\"UserId\", \"Name\", \"ReminderTime\", \"CreatedAt\", \"FrequencyType\") " +
                "VALUES (7, 'Stretch', '09:00', now(), 0), (7, 'Read', NULL, now(), 0)");
        }

        var now = new DateTimeOffset(2027, 1, 15, 12, 0, 0, TimeSpan.Zero);
        using var host = AppHost.CreateHostBuilder([], new EmberHostOptions
        {
            IncludeDiscordGateway = false,
            ConfigureDbContext = (o, _) => o.UseNpgsql(connectionString),
            ConfigureServices = (services, _) => services.AddSingleton<TimeProvider>(new FakeTimeProvider(now))
        }).Build();

        await AppHost.InitializeAsync(host);

        await using var scope = host.Services.CreateAsyncScope();
        var next = await scope.ServiceProvider.GetRequiredService<EmberDbContext>().Habits
            .OrderBy(h => h.Name).Select(h => new { h.Name, h.NextReminderUtc }).ToListAsync();
        next.Should().BeEquivalentTo([
            new { Name = "Read", NextReminderUtc = (DateTime?)null },
            new { Name = "Stretch", NextReminderUtc = (DateTime?)new DateTime(2027, 1, 16, 0, 0, 0, DateTimeKind.Utc) }]);
    }
}
