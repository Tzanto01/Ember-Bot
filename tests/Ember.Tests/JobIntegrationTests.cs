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
    private static readonly DateTimeOffset ReflectionHourUtc = new(2026, 1, 14, 10, 0, 0, TimeSpan.Zero);

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
        await using var host = await IntegrationTestHost.CreateAsync(time: new FakeTimeProvider(ReflectionHourUtc));

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var yesterday = DateOnly.FromDateTime(ReflectionHourUtc.UtcDateTime).AddDays(-1);

            var eligibleUser = new User { DiscordUserId = 1001, Timezone = "UTC" };
            eligibleUser.Habits.Add(new Habit
            {
                Name = "Stretch",
                CreatedAt = ReflectionHourUtc.UtcDateTime.AddDays(-5),
                Logs = []
            });

            var pausedUser = new User { DiscordUserId = 1002, Timezone = "UTC" };
            pausedUser.Habits.Add(new Habit
            {
                Name = "Walk",
                CreatedAt = ReflectionHourUtc.UtcDateTime.AddDays(-5),
                PausedUntil = yesterday
            });

            var newUser = new User { DiscordUserId = 1003, Timezone = "UTC" };
            newUser.Habits.Add(new Habit
            {
                Name = "Journal",
                CreatedAt = ReflectionHourUtc.UtcDateTime,
            });

            var lowDayUser = new User { DiscordUserId = 1004, Timezone = "UTC" };
            lowDayUser.Habits.Add(new Habit { Name = "Read", CreatedAt = ReflectionHourUtc.UtcDateTime.AddDays(-5) });
            lowDayUser.DayMarks.Add(new DayMark { Date = yesterday, Kind = DayMarkKind.LowDay });

            db.Users.AddRange(eligibleUser, pausedUser, newUser, lowDayUser);
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

    [Fact]
    public async Task MissedDayReflectionJob_MessagesOnlyUsersWhoseLocalHourIsTen()
    {
        // 01:00 UTC on Jan 14 is 10:00 in Tokyo and 01:00 in UTC.
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 1, 14, 1, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(time: time);

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var created = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

            var utcUser = new User { DiscordUserId = 1101, Timezone = "UTC" };
            utcUser.Habits.Add(new Habit { Name = "Walk", CreatedAt = created });

            var tokyoUser = new User { DiscordUserId = 1102, Timezone = "Asia/Tokyo" };
            tokyoUser.Habits.Add(new Habit { Name = "Stretch", CreatedAt = created });

            db.Users.AddRange(utcUser, tokyoUser);
            await db.SaveChangesAsync();
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(MissedDayReflectionJob.Key);
        await host.WaitForDmCountAsync(1);

        host.Discord.Messages.Should().ContainSingle().Which.UserId.Should().Be(1102);
    }

    [Fact]
    public async Task MissedDayReflectionJob_WeeklyHabitBehindTargetAtWeekEnd_GetsNudge()
    {
        // Sunday Jan 18, 10:00 UTC: yesterday was Saturday, one day left in the Mon–Sun week.
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 1, 18, 10, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(time: time);

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var user = new User { DiscordUserId = 1201, Timezone = "UTC" };
            var habit = new Habit
            {
                Name = "Swim",
                FrequencyType = FrequencyType.Weekly,
                WeeklyTarget = 3,
                CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)
            };
            habit.Logs.Add(new HabitLog { Date = new DateOnly(2026, 1, 15), Completed = true });
            user.Habits.Add(habit);
            db.Users.Add(user);
            await db.SaveChangesAsync();
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(MissedDayReflectionJob.Key);
        await host.WaitForDmCountAsync(1);

        host.Discord.Messages.Should().ContainSingle()
            .Which.Embed!.Description.Should().Contain("1/3 this week");
    }

    [Fact]
    public async Task MissedDayReflectionJob_OnLocalMonday_DoesNotNudgeAboutTheFinishedWeek()
    {
        // 00:00 UTC Mon Jan 19 = 10:00 Monday in Brisbane (UTC+10); yesterday closed last week.
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 1, 19, 0, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(time: time);

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var created = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

            var weeklyUser = new User { DiscordUserId = 1301, Timezone = "Australia/Brisbane" };
            var weekly = new Habit { Name = "Swim", FrequencyType = FrequencyType.Weekly, WeeklyTarget = 3, CreatedAt = created };
            weekly.Logs.Add(new HabitLog { Date = new DateOnly(2026, 1, 15), Completed = true });
            weeklyUser.Habits.Add(weekly);

            // Processed after the weekly user, so its DM proves the run reached the end.
            var dailyUser = new User { DiscordUserId = 1302, Timezone = "Australia/Brisbane" };
            dailyUser.Habits.Add(new Habit { Name = "Stretch", CreatedAt = created });

            db.Users.AddRange(weeklyUser, dailyUser);
            await db.SaveChangesAsync();
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(MissedDayReflectionJob.Key);
        await host.WaitForDmCountAsync(1);

        host.Discord.Messages.Should().ContainSingle().Which.UserId.Should().Be(1302);
    }

    [Fact]
    public async Task MissedDayReflectionJob_UsesTheUsersLocalYesterday_NotTheUtcOne()
    {
        // 21:00 UTC Jan 13 = 10:00 Jan 14 in Auckland (UTC+13): local yesterday is Jan 13,
        // UTC yesterday would be Jan 12. Only Jan 12 was checked in, so Jan 13 was missed.
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 1, 13, 21, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(time: time);

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var user = new User { DiscordUserId = 1401, Timezone = "Pacific/Auckland" };
            var habit = new Habit { Name = "Stretch", CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) };
            habit.Logs.Add(new HabitLog { Date = new DateOnly(2026, 1, 12), Completed = true });
            user.Habits.Add(habit);
            db.Users.Add(user);
            await db.SaveChangesAsync();
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(MissedDayReflectionJob.Key);
        await host.WaitForDmCountAsync(1);

        host.Discord.Messages.Should().ContainSingle().Which.UserId.Should().Be(1401);
    }
}