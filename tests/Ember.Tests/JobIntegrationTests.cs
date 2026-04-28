using Ember.Bot.Data;
using Ember.Bot.Jobs;
using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Quartz;

namespace Ember.Tests;

[Collection("Integration")]
public class JobIntegrationTests
{
    [Fact]
    public async Task ReminderJob_TriggeredForScheduledHabit_SendsDm()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        var habitId = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var habit = await service.AddHabitAsync(10, "Stretch", new TimeOnly(8, 0));

            var db = sp.GetRequiredService<EmberDbContext>();
            db.HabitLogs.Add(new HabitLog
            {
                HabitId = habit.Id,
                Date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1),
                Completed = true
            });
            await db.SaveChangesAsync();

            return habit.Id;
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(new JobKey($"habit-{habitId}", "reminders"));
        await host.WaitForDmCountAsync(1);

        host.Discord.Messages.Should().ContainSingle();
        host.Discord.Messages[0].UserId.Should().Be(10);
        host.Discord.Messages[0].Text.Should().Contain("Stretch");
        host.Discord.Messages[0].Components.Should().NotBeNull();
    }

    [Fact]
    public async Task ReminderJob_DoesNotSendWhenHabitAlreadyCompletedToday()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        var habitId = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var habit = await service.AddHabitAsync(10, "Read", new TimeOnly(8, 0));
            await service.CheckInAsync(10, habit.Id, completed: true);
            return habit.Id;
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(new JobKey($"habit-{habitId}", "reminders"));
        await Task.Delay(250);

        host.Discord.Messages.Should().BeEmpty();
    }

    [Fact]
    public async Task WeeklySummaryJob_Triggered_SendsSummaryEmbed()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var today = DateOnly.FromDateTime(DateTime.UtcNow);

            var user = new User { DiscordUserId = 55, Timezone = "UTC" };
            var habit = new Habit { UserId = 55, Name = "Meditate", CreatedAt = DateTime.UtcNow.AddDays(-8) };
            habit.Logs.Add(new HabitLog { Date = today.AddDays(-1), Completed = true });
            habit.Logs.Add(new HabitLog { Date = today.AddDays(-3), Completed = true });
            user.Habits.Add(habit);

            db.Users.Add(user);
            await db.SaveChangesAsync();
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(WeeklySummaryJob.Key);
        await host.WaitForDmCountAsync(1);

        var message = host.Discord.Messages.Single();
        message.UserId.Should().Be(55);
        message.Embed.Should().NotBeNull();
        message.Embed!.Title.Should().Be("🗓️ Your weekly habit summary");
        message.Embed.Fields.Should().ContainSingle(f => f.Name == "Meditate");
    }

    [Fact]
    public async Task MissedDayReflectionJob_Triggered_SendsOnlyForEligibleMissedHabit()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var yesterday = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);

            var eligibleUser = new User { DiscordUserId = 1001, Timezone = "UTC" };
            eligibleUser.Habits.Add(new Habit
            {
                Name = "Stretch",
                CreatedAt = DateTime.UtcNow.AddDays(-5),
                Logs = []
            });

            var pausedUser = new User { DiscordUserId = 1002, Timezone = "UTC" };
            pausedUser.Habits.Add(new Habit
            {
                Name = "Walk",
                CreatedAt = DateTime.UtcNow.AddDays(-5),
                PausedUntil = yesterday
            });

            var newUser = new User { DiscordUserId = 1003, Timezone = "UTC" };
            newUser.Habits.Add(new Habit
            {
                Name = "Journal",
                CreatedAt = DateTime.UtcNow,
            });

            db.Users.AddRange(eligibleUser, pausedUser, newUser);
            await db.SaveChangesAsync();
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(MissedDayReflectionJob.Key);
        await host.WaitForDmCountAsync(1);

        host.Discord.Messages.Should().ContainSingle();
        host.Discord.Messages[0].UserId.Should().Be(1001);
        host.Discord.Messages[0].Embed.Should().NotBeNull();
        host.Discord.Messages[0].Embed!.Title.Should().Be("💙 A gentle check-in");
    }
}
