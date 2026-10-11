using Ember.Bot.Data;
using Ember.Bot.Jobs;
using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;
using Quartz;

namespace Ember.Tests;

[Collection("Integration")]
public class JobIntegrationTests
{
    private static readonly DateTimeOffset SundayMorningUtc = new(2026, 1, 18, 9, 0, 0, TimeSpan.Zero);

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
        host.Discord.Messages[0].Text.Should().Contain("Did you follow this habit today?");
        host.Discord.Messages[0].Components.Should().NotBeNull();
    }

    [Fact]
    public async Task SnoozeReminderJob_TriggeredForScheduledHabit_ReasksWhetherHabitWasFollowedToday()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var habit = await service.AddHabitAsync(20, "Journal", new TimeOnly(8, 0));

            var scheduler = sp.GetRequiredService<ReminderScheduler>();
            await scheduler.SnoozeAsync(habit.Id, (long)habit.UserId, habit.Name, delayMinutes: 0);
        });

        await host.WaitForDmCountAsync(1);

        host.Discord.Messages.Should().ContainSingle();
        host.Discord.Messages[0].UserId.Should().Be(20);
        host.Discord.Messages[0].Text.Should().Contain("Journal");
        host.Discord.Messages[0].Text.Should().Contain("Did you follow this habit today?");
        host.Discord.Messages[0].Components.Should().NotBeNull();
    }

    [Fact]
    public async Task ReminderJob_SendsEvenWhenHabitAlreadyCompletedToday()
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
        await host.WaitForDmCountAsync(1);

        host.Discord.Messages.Should().ContainSingle(m => m.UserId == 10);
    }

    [Fact]
    public async Task WeeklySummaryJob_Triggered_SendsSummaryWithCountStreakAndToneLine()
    {
        await using var host = await IntegrationTestHost.CreateAsync(time: new FakeTimeProvider(SundayMorningUtc));

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var today = DateOnly.FromDateTime(SundayMorningUtc.UtcDateTime);

            var user = new User { DiscordUserId = 55, Timezone = "UTC" };
            var habit = new Habit { UserId = 55, Name = "Meditate", CreatedAt = SundayMorningUtc.UtcDateTime.AddDays(-8) };
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

        // 2 of 7 possible check-ins → tone line for an under-half week (29%).
        message.Embed.Description.Should().Contain("**2/7**").And.Contain("(29%)");
        message.Embed.Footer!.Value.Text.Should().Be("Small steps still move forward. You've got this.");

        // Per-habit line: dot history (oldest→newest), count, and the *current* streak —
        // logs at -1 and -3 with the default 1 grace day bridge to a streak of 2.
        var field = message.Embed.Fields.Should().ContainSingle(f => f.Name == "Meditate").Subject;
        field.Value.Should().Be("⬜⬜⬜⬜✅⬜✅ **2/7** · Streak: **2** days _(+1 flex)_");
    }

    [Fact]
    public async Task WeeklySummaryJob_ZeroActivityUser_GetsGentleNudge_UsersWithNothingToSummarise_AreSkipped()
    {
        // Deliberate zero-activity handling (documented here per acceptance criteria):
        //
        // A user with an established habit but ZERO check-ins in the window still gets
        // a DM — the gentle "quiet week" nudge, not silence. Ember's core philosophy
        // (idea.md: "no punishment, no guilt", "gentle re-engagement") means the bot
        // must not go quiet at exactly the moment a user disengages; the summary IS the
        // re-engagement hook, and its copy carries zero guilt.
        //
        // Skipping is reserved for users with nothing to summarise at all: no habits,
        // or every habit created today / paused through the window — for them a 0/0
        // recap would be pure noise (and paused users asked for quiet).
        await using var host = await IntegrationTestHost.CreateAsync(time: new FakeTimeProvider(SundayMorningUtc));

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();

            // Seeded first so it is processed before the nudge user's DM arrives:
            // habit created today → zero countable days in the window → skipped.
            var brandNew = new User { DiscordUserId = 74, Timezone = "UTC" };
            brandNew.Habits.Add(new Habit { UserId = 74, Name = "Stretch", CreatedAt = SundayMorningUtc.UtcDateTime });

            // Established habit, no check-ins at all → gentle nudge.
            var quietWeek = new User { DiscordUserId = 77, Timezone = "UTC" };
            quietWeek.Habits.Add(new Habit { UserId = 77, Name = "Journal", CreatedAt = SundayMorningUtc.UtcDateTime.AddDays(-10) });

            // No habits at all → nothing to summarise, never queried.
            var noHabits = new User { DiscordUserId = 78, Timezone = "UTC" };

            db.Users.AddRange(brandNew, quietWeek, noHabits);
            await db.SaveChangesAsync();
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(WeeklySummaryJob.Key);
        await host.WaitForDmCountAsync(1);

        var message = host.Discord.Messages.Single(); // only the quiet-week user — 74 and 78 skipped
        message.UserId.Should().Be(77);
        message.Embed.Should().NotBeNull();
        message.Embed!.Description.Should().Contain("quiet week").And.Contain("that's okay");
        message.Embed.Footer!.Value.Text.Should().Be("No pressure. Progress happens at its own pace.");
    }

    [Fact]
    public async Task WeeklySummaryJob_UserWithMoreHabitsThanEmbedFieldLimit_StillGetsDmWithOverflowLine()
    {
        // Discord embeds cap at 25 fields; without the overflow guard, AddField throws
        // on the 26th habit and the per-user catch swallows it — the most-engaged users
        // would silently get no summary at all.
        await using var host = await IntegrationTestHost.CreateAsync(time: new FakeTimeProvider(SundayMorningUtc));

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();

            var user = new User { DiscordUserId = 90, Timezone = "UTC" };
            for (var i = 1; i <= 30; i++)
            {
                user.Habits.Add(new Habit
                {
                    UserId = 90,
                    Name = $"Habit {i:00}",
                    CreatedAt = SundayMorningUtc.UtcDateTime.AddDays(-10).AddMinutes(i)
                });
            }

            db.Users.Add(user);
            await db.SaveChangesAsync();
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(WeeklySummaryJob.Key);
        await host.WaitForDmCountAsync(1);

        var message = host.Discord.Messages.Single();
        message.UserId.Should().Be(90);
        message.Embed.Should().NotBeNull();
        message.Embed!.Fields.Length.Should().Be(25); // 24 habits + 1 overflow line

        var overflowField = message.Embed.Fields[^1];
        overflowField.Value.Should().Contain("**6** more habits"); // 30 - 24 shown
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
