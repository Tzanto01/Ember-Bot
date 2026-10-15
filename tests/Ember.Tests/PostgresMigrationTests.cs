using Ember.Bot;
using Ember.Core.Data;
using Ember.Core.Services;
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
            await service.GiveHealthDataConsentAsync(4242);
            var habit = await service.AddHabitAsync(4242, "Stretch", new TimeOnly(7, 30));
            habitId = habit.Id;
            (await service.CheckInAsync(4242, habitId, await service.GetLocalTodayAsync(4242), completed: true, guildId: 99))
                .Should().Be(DayEditResult.Saved);
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
    public async Task PausedFromMigration_StartsRunningPausesOnTheMigrationDate_AndEmptiesEndedPauses()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        var options = new DbContextOptionsBuilder<EmberDbContext>().UseNpgsql(connectionString).Options;
        await using var db = new EmberDbContext(options);
        var migrator = db.GetService<IMigrator>();

        await migrator.MigrateAsync("20261013073035_AddDayMarks");
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"Users\" (\"DiscordUserId\", \"Timezone\", \"GraceDaysPerWeek\", \"LeaderboardOptIn\") VALUES (1, 'UTC', 1, FALSE);" +
            "INSERT INTO \"Habits\" (\"UserId\", \"Name\", \"CreatedAt\", \"FrequencyType\", \"PausedUntil\") VALUES " +
            "(1, 'Paused', now(), 0, '2999-01-01'), (1, 'Ended', now(), 0, '2020-01-10'), (1, 'Active', now(), 0, NULL)");

        var before = await CurrentDateAsync(db);
        await migrator.MigrateAsync();
        var after = await CurrentDateAsync(db);

        var habits = await db.Habits.AsNoTracking().OrderBy(h => h.Name).ToListAsync();
        habits.Select(h => h.Name).Should().Equal("Active", "Ended", "Paused");
        habits[0].PausedFrom.Should().BeNull();
        habits[1].PausedFrom.Should().Be(new DateOnly(2020, 1, 11));
        habits[1].PausedUntil.Should().Be(new DateOnly(2020, 1, 10));
        HabitService.IsPausedOn(habits[1], new DateOnly(2020, 1, 1)).Should().BeFalse("an ended pause no longer hides earlier history");
        habits[2].PausedFrom.Should().NotBeNull();
        habits[2].PausedFrom!.Value.Should().BeOnOrAfter(before).And.BeOnOrBefore(after);
    }

    private static async Task<DateOnly> CurrentDateAsync(EmberDbContext db)
        => (await db.Database.SqlQueryRaw<DateOnly>("SELECT CURRENT_DATE AS \"Value\"").ToListAsync()).Single();

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
