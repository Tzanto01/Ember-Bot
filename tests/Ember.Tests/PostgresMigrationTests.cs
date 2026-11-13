using Ember.Bot;
using Ember.Core.Data;
using Ember.Core.Models;
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
            var stored = await db.Habits.Include(h => h.User).ThenInclude(u => u.Logins).Include(h => h.Logs).SingleAsync(h => h.Id == habitId);

            stored.User.DiscordId().Should().Be(4242UL);
            stored.Name.Should().Be("Stretch");
            stored.ReminderTime.Should().Be(new TimeOnly(7, 30));
            stored.Logs.Should().ContainSingle(l => l.Completed && l.GuildId == 99);
        }
    }

    [DockerFact]
    public async Task FeaturesV16Migration_KeepsHabitsAndLogs_AndCountsCompletedDaysOnce()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        var options = new DbContextOptionsBuilder<EmberDbContext>().UseNpgsql(connectionString).Options;
        await using var db = new EmberDbContext(options);
        var migrator = db.GetService<IMigrator>();

        await migrator.MigrateAsync("20261102120000_AddUserTheme");
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"AspNetUsers\" (\"Id\", \"Timezone\", \"GraceDaysPerWeek\", \"LeaderboardOptIn\", \"DmFailureCount\", " +
            "\"EmailConfirmed\", \"PhoneNumberConfirmed\", \"TwoFactorEnabled\", \"LockoutEnabled\", \"AccessFailedCount\") " +
            "VALUES ('00000000-0000-0000-0000-000000000001', 'Europe/Berlin', 1, TRUE, 0, FALSE, FALSE, FALSE, FALSE, 0);" +
            "INSERT INTO \"Habits\" (\"Id\", \"UserId\", \"Name\", \"CreatedAt\", \"FrequencyType\", \"WeeklyTarget\", \"ReminderChannels\") VALUES " +
            "(1, '00000000-0000-0000-0000-000000000001', 'Stretch', now(), 0, NULL, 1), " +
            "(2, '00000000-0000-0000-0000-000000000001', 'Read', now(), 1, 3, 1);" +
            "INSERT INTO \"HabitLogs\" (\"HabitId\", \"Date\", \"Completed\") VALUES " +
            "(1, '2026-10-01', TRUE), (1, '2026-10-02', FALSE), (2, '2026-10-01', TRUE)");

        await migrator.MigrateAsync();

        var habits = await db.Habits.AsNoTracking().Include(h => h.Logs).OrderBy(h => h.Id).ToListAsync();
        habits.Select(h => h.FrequencyType).Should().Equal(FrequencyType.Daily, FrequencyType.Weekly);
        habits[1].WeeklyTarget.Should().Be(3);
        habits.Should().OnlyContain(h => h.TimesPerDay == 1 && h.Days == null && h.RoutineId == null);
        habits[0].Logs.OrderBy(l => l.Date).Select(l => (l.Completed, l.Count)).Should().Equal((true, 1), (false, 0));
        habits[1].Logs.Should().ContainSingle(l => l.Completed && l.Count == 1);
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

    [DockerFact]
    public async Task HabitReminderTimesMigration_CarriesEachReminderTimeOver()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        var options = new DbContextOptionsBuilder<EmberDbContext>().UseNpgsql(connectionString).Options;
        await using var db = new EmberDbContext(options);
        var migrator = db.GetService<IMigrator>();

        await migrator.MigrateAsync("20261111163159_PushSubscriptionSession");
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"AspNetUsers\" (\"Id\", \"Timezone\", \"GraceDaysPerWeek\", \"DmFailureCount\", \"EmailConfirmed\", " +
            "\"PhoneNumberConfirmed\", \"TwoFactorEnabled\", \"LockoutEnabled\", \"AccessFailedCount\", \"SecondReminderMinutes\") " +
            "VALUES ('00000000-0000-0000-0000-000000000001', 'Europe/Berlin', 1, 0, FALSE, FALSE, FALSE, FALSE, 0, 0);" +
            "INSERT INTO \"Habits\" (\"Id\", \"UserId\", \"Name\", \"ReminderTime\", \"CreatedAt\", \"FrequencyType\", \"ReminderChannels\", \"RoutinePosition\") VALUES " +
            "(1, '00000000-0000-0000-0000-000000000001', 'Stretch', '07:30', now(), 0, 1, 0), " +
            "(2, '00000000-0000-0000-0000-000000000001', 'Read', NULL, now(), 0, 1, 0)");

        await migrator.MigrateAsync();

        var habits = await db.Habits.AsNoTracking().OrderBy(h => h.Id).ToListAsync();
        habits[0].ReminderTimes.Should().Equal(new TimeOnly(7, 30));
        habits[1].ReminderTimes.Should().BeEmpty();
    }

    [DockerFact]
    public async Task MultiDeviceRemindersMigration_StartsEverythingEverywhere_KeepsTodaysDiscordUsersAsYes_AndGoesBackDown()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        var options = new DbContextOptionsBuilder<EmberDbContext>().UseNpgsql(connectionString).Options;
        await using var db = new EmberDbContext(options);
        var migrator = db.GetService<IMigrator>();

        await migrator.MigrateAsync("20261112001345_AddFeedback");
        string Id(int n) => $"'00000000-0000-0000-0000-00000000000{n}'";
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"AspNetUsers\" (\"Id\", \"Timezone\", \"GraceDaysPerWeek\", \"DmFailureCount\", \"EmailConfirmed\", " +
            "\"PhoneNumberConfirmed\", \"TwoFactorEnabled\", \"LockoutEnabled\", \"AccessFailedCount\", \"SecondReminderMinutes\") VALUES " +
            string.Join(", ", Enumerable.Range(1, 4).Select(n => $"({Id(n)}, 'Europe/Berlin', 1, 0, FALSE, FALSE, FALSE, FALSE, 0, 0)")) + ";" +
            "INSERT INTO \"AspNetUserLogins\" (\"LoginProvider\", \"ProviderKey\", \"ProviderDisplayName\", \"UserId\") VALUES " +
            $"('Discord', '101', 'Discord', {Id(1)}), ('Discord', '102', 'Discord', {Id(2)}), ('Discord', '103', 'Discord', {Id(3)});" +
            "INSERT INTO \"Habits\" (\"Id\", \"UserId\", \"Name\", \"ReminderTimes\", \"CreatedAt\", \"FrequencyType\", \"ReminderChannels\", \"RoutinePosition\") VALUES " +
            $"(1, {Id(1)}, 'Stretch', ARRAY['07:30'::time], now(), 0, 3, 0), " +
            $"(2, {Id(2)}, 'Read', ARRAY[]::time[], now(), 0, 1, 0), " +
            $"(3, {Id(4)}, 'Walk', ARRAY['09:00'::time], now(), 0, 1, 0);" +
            "INSERT INTO \"Routines\" (\"Id\", \"UserId\", \"Name\", \"ReminderTime\", \"CreatedAt\", \"ReminderChannels\") VALUES " +
            $"(1, {Id(2)}, 'Evening', '21:00', now(), 2), (2, {Id(3)}, 'Morning', '07:00', now(), 1);" +
            "INSERT INTO \"PushSubscriptions\" (\"UserId\", \"Endpoint\", \"P256dh\", \"Auth\", \"CreatedAt\") VALUES " +
            $"({Id(1)}, 'https://fcm.googleapis.com/fcm/send/a', 'k', 'a', now())");

        await migrator.MigrateAsync();

        (await db.Users.AsNoTracking().OrderBy(u => u.Id).Select(u => u.DiscordReminders).ToListAsync()).Should().Equal(true, null, true, null);
        (await db.Habits.AsNoTracking().ToListAsync()).Should().OnlyContain(h => h.ReminderExclusions.Count == 0);
        (await db.Routines.AsNoTracking().ToListAsync()).Should().OnlyContain(r => r.ReminderExclusions.Count == 0);
        (await db.PushSubscriptions.AsNoTracking().SingleAsync()).Should().Match<Ember.Core.Models.PushSubscription>(s => s.Enabled && s.Label == null);

        await db.Habits.Where(h => h.Id == 1).ExecuteUpdateAsync(s => s.SetProperty(h => h.ReminderExclusions, new List<string> { "discord" }));
        await db.Database.ExecuteSqlRawAsync(
            $"INSERT INTO \"Habits\" (\"Id\", \"UserId\", \"Name\", \"ReminderTimes\", \"CreatedAt\", \"FrequencyType\", \"RoutinePosition\") VALUES (4, {Id(1)}, 'Water', ARRAY[]::time[], now(), 0, 0);" +
            $"INSERT INTO \"ReminderPhones\" (\"UserId\", \"InstallId\", \"Label\", \"Enabled\", \"CreatedAt\") VALUES ({Id(1)}, 'install-0000000001', 'Pixel 8', TRUE, now());" +
            $"INSERT INTO \"PushReminders\" (\"UserId\", \"HabitId\", \"Date\") VALUES ({Id(1)}, 4, '2027-01-15')");

        await migrator.MigrateAsync("20261112001345_AddFeedback");

        (await db.Database.SqlQueryRaw<int>("SELECT \"ReminderChannels\" AS \"Value\" FROM \"Habits\" ORDER BY \"Id\"").ToListAsync())
            .Should().Equal(6, 6, 6, 7);
        (await db.Database.SqlQueryRaw<int>("SELECT \"ReminderChannels\" AS \"Value\" FROM \"Routines\" ORDER BY \"Id\"").ToListAsync())
            .Should().Equal(6, 7);
        (await db.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM information_schema.tables WHERE table_name IN ('ReminderPhones', 'PushReminders')").ToListAsync())
            .Should().Equal(0);
    }

    [DockerFact]
    public async Task FeedbackTitleMigration_GivesEachExistingReportATitleFromItsFirstLine()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        var options = new DbContextOptionsBuilder<EmberDbContext>().UseNpgsql(connectionString).Options;
        await using var db = new EmberDbContext(options);
        var migrator = db.GetService<IMigrator>();

        await migrator.MigrateAsync("20261112001345_AddFeedback");
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"Feedback\" (\"Platform\", \"Text\", \"CreatedAt\") VALUES " +
            "('web', E'Dark mode please\r\nIt hurts my eyes at night', now()), " +
            "('android', E'one line', now()), " +
            "('web', repeat('x', 150), now())");

        await migrator.MigrateAsync();

        var stored = await db.Feedback.AsNoTracking().OrderBy(f => f.Id).ToListAsync();
        stored.Select(f => f.Title).Should().Equal("Dark mode please", "one line", new string('x', 100));
        stored.Select(f => f.Text).Should().Equal("Dark mode please\r\nIt hurts my eyes at night", "one line", new string('x', 150));
        stored.Should().OnlyContain(f => f.ResolvedAt == null);
    }

    [DockerFact]
    public async Task ShowStreaksMigration_KeepsStreaksOnForExistingAccounts_NewAccountsStartWithThemOff()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        var options = new DbContextOptionsBuilder<EmberDbContext>().UseNpgsql(connectionString).Options;
        await using var db = new EmberDbContext(options);
        var migrator = db.GetService<IMigrator>();

        await migrator.MigrateAsync("20261112101409_AddFeedbackTitleAndImages");
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"AspNetUsers\" (\"Id\", \"Timezone\", \"GraceDaysPerWeek\", \"DmFailureCount\", \"EmailConfirmed\", " +
            "\"PhoneNumberConfirmed\", \"TwoFactorEnabled\", \"LockoutEnabled\", \"AccessFailedCount\", \"SecondReminderMinutes\") " +
            "VALUES ('00000000-0000-0000-0000-000000000001', 'Europe/Berlin', 1, 0, FALSE, FALSE, FALSE, FALSE, 0, 0)");

        await migrator.MigrateAsync();
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"AspNetUsers\" (\"Id\", \"Timezone\", \"GraceDaysPerWeek\", \"DmFailureCount\", \"EmailConfirmed\", " +
            "\"PhoneNumberConfirmed\", \"TwoFactorEnabled\", \"LockoutEnabled\", \"AccessFailedCount\", \"SecondReminderMinutes\") " +
            "VALUES ('00000000-0000-0000-0000-000000000002', 'Europe/Berlin', 1, 0, FALSE, FALSE, FALSE, FALSE, 0, 0)");

        (await db.Users.AsNoTracking().OrderBy(u => u.Id).Select(u => u.ShowStreaks).ToListAsync()).Should().Equal(true, false);

        await migrator.MigrateAsync("20261112101409_AddFeedbackTitleAndImages");
        (await db.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM information_schema.columns WHERE column_name = 'ShowStreaks'").ToListAsync())
            .Should().Equal(0);
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
