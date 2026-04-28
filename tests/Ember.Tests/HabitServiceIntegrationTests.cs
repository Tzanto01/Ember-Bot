using Ember.Bot.Data;
using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
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
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        (await scheduler.CheckExists(new JobKey($"habit-{habitId}", "reminders"))).Should().BeTrue();
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
    public async Task GetLeaderboardAsync_ExcludesOptOutAndOtherGuilds()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var today = DateOnly.FromDateTime(DateTime.UtcNow);

            db.Users.AddRange(
                new User { DiscordUserId = 1, Timezone = "UTC", LeaderboardOptOut = false },
                new User { DiscordUserId = 2, Timezone = "UTC", LeaderboardOptOut = true },
                new User { DiscordUserId = 3, Timezone = "UTC", LeaderboardOptOut = false });

            db.Habits.AddRange(
                new Habit { Id = 10, UserId = 1, Name = "Hydrate", CreatedAt = DateTime.UtcNow.AddDays(-10) },
                new Habit { Id = 20, UserId = 2, Name = "Walk", CreatedAt = DateTime.UtcNow.AddDays(-10) },
                new Habit { Id = 30, UserId = 3, Name = "Study", CreatedAt = DateTime.UtcNow.AddDays(-10) });

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
            return await service.GetLeaderboardAsync(999, top: 10);
        });

        leaderboard.Should().ContainSingle();
        leaderboard[0].UserId.Should().Be(1);
        leaderboard[0].CheckIns.Should().Be(2);
    }
}
