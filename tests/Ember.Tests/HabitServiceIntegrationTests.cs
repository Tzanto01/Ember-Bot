using Ember.Bot.Data;
using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;
using Quartz;

namespace Ember.Tests;

[Collection("Integration")]
public class HabitServiceIntegrationTests
{
    [Fact]
    public async Task AddHabitAsync_CreatesUserHabitAndSchedule()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        var habitId = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var habit = await service.AddHabitAsync(123, "Drink Water", new TimeOnly(9, 0));
            return habit.Id;
        });

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var user = await db.Users.FindAsync(123L);
            var habit = await db.Habits.FindAsync(habitId);

            user.Should().NotBeNull();
            habit.Should().NotBeNull();
            habit!.Name.Should().Be("Drink Water");
            habit.ReminderTime.Should().Be(new TimeOnly(9, 0));
            habit.NextReminderUtc.Should().NotBeNull();
        });
    }

    [Fact]
    public async Task EditHabitAsync_ClearingReminderUnschedulesJob()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        var habitId = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var habit = await service.AddHabitAsync(123, "Journal", new TimeOnly(21, 30));
            await service.EditHabitAsync(123, habit.Id, null, null, clearReminder: true);
            return habit.Id;
        });

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var habit = await db.Habits.FindAsync(habitId);
            habit.Should().NotBeNull();
            habit!.ReminderTime.Should().BeNull();
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        (await scheduler.CheckExists(new JobKey($"habit-{habitId}", "reminders"))).Should().BeFalse();
    }

    [Fact]
    public async Task CheckInAsync_UpsertsTodaysLogAndUpdatesGuild()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var db = sp.GetRequiredService<EmberDbContext>();

            var habit = await service.AddHabitAsync(456, "Read", reminderTime: null);
            await service.CheckInAsync(456, habit.Id, completed: true, guildId: 100);
            await service.CheckInAsync(456, habit.Id, completed: false, guildId: 200);

            var logs = db.HabitLogs.Where(l => l.HabitId == habit.Id).ToList();
            logs.Should().HaveCount(1);
            logs[0].Completed.Should().BeFalse();
            logs[0].GuildId.Should().Be(200);
        });
    }

    [Fact]
    public async Task AddHabitAsync_BeyondThePerUserLimit_IsRefusedAndNothingIsAdded()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var db = sp.GetRequiredService<EmberDbContext>();

            for (var i = 1; i <= HabitService.MaxHabitsPerUser; i++)
                await service.AddHabitAsync(789, $"Habit {i}", reminderTime: null);

            var add51st = () => service.AddHabitAsync(789, "One more", reminderTime: null, FrequencyType.Weekly, 2);

            await add51st.Should().ThrowAsync<HabitLimitReachedException>();
            db.Habits.Count(h => h.UserId == 789).Should().Be(HabitService.MaxHabitsPerUser);
        });
    }

    [Fact]
    public async Task GetLeaderboardAsync_UserWhoNeverOptedIn_NeverAppears()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        var leaderboard = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var habit = await service.AddHabitAsync(321, "Hydrate", reminderTime: null);
            await service.CheckInAsync(321, habit.Id, completed: true, guildId: 999);
            return await service.GetLeaderboardAsync(999, top: 10);
        });

        leaderboard.Should().BeEmpty();
    }

    [Fact]
    public async Task GetLeaderboardAsync_IncludesOnlyOptedInUsersOfThatGuild()
    {
        var now = new DateTimeOffset(2026, 1, 14, 12, 0, 0, TimeSpan.Zero);
        await using var host = await IntegrationTestHost.CreateAsync(time: new FakeTimeProvider(now));

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var today = DateOnly.FromDateTime(now.UtcDateTime);

            db.Users.AddRange(
                new User { DiscordUserId = 1, Timezone = "UTC" },
                new User { DiscordUserId = 2, Timezone = "UTC" },
                new User { DiscordUserId = 3, Timezone = "UTC" });

            db.Habits.AddRange(
                new Habit { Id = 10, UserId = 1, Name = "Hydrate", CreatedAt = now.UtcDateTime.AddDays(-10) },
                new Habit { Id = 20, UserId = 2, Name = "Walk", CreatedAt = now.UtcDateTime.AddDays(-10) },
                new Habit { Id = 30, UserId = 3, Name = "Study", CreatedAt = now.UtcDateTime.AddDays(-10) });

            db.HabitLogs.AddRange(
                new HabitLog { HabitId = 10, Date = today, Completed = true, GuildId = 999 },
                new HabitLog { HabitId = 10, Date = today.AddDays(-1), Completed = true, GuildId = 999 },
                new HabitLog { HabitId = 20, Date = today, Completed = true, GuildId = 999 },
                new HabitLog { HabitId = 30, Date = today, Completed = true, GuildId = 555 });

            await db.SaveChangesAsync();
        });

        var leaderboard = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.SetLeaderboardOptInAsync(1, true);
            await service.SetLeaderboardOptInAsync(3, true);
            await service.SetLeaderboardOptInAsync(2, true);
            await service.SetLeaderboardOptInAsync(2, false);
            return await service.GetLeaderboardAsync(999, top: 10);
        });

        leaderboard.Should().ContainSingle();
        leaderboard[0].UserId.Should().Be(1);
        leaderboard[0].CheckIns.Should().Be(2);
    }
}
