using Ember.Bot;
using Ember.Bot.Services;
using Ember.Core.Data;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;
using Quartz;
using Quartz.Impl.Matchers;

namespace Ember.Tests;

[Collection("Integration")]
public class AppHostIntegrationTests
{
    [Fact]
    public async Task InitializeAsync_CreatesDatabaseAndQuartzRegistrations()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        var canConnect = await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            return await db.Database.CanConnectAsync();
        });

        canConnect.Should().BeTrue();

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        (await scheduler.CheckExists(Ember.Bot.Jobs.WeeklySummaryJob.Key)).Should().BeTrue();
        (await scheduler.CheckExists(Ember.Bot.Jobs.MissedDayReflectionJob.Key)).Should().BeTrue();
        (await scheduler.CheckExists(Ember.Bot.Jobs.ReminderDispatchJob.Key)).Should().BeTrue();

        var reminderCron = (await host.GetTriggerAsync("reminder-dispatch-trigger", "reminders"))
            .Should().BeAssignableTo<ICronTrigger>().Subject;
        reminderCron.CronExpressionString.Should().Be("0 * * * * ?");

        var weeklyTrigger = await host.GetTriggerAsync("weekly-summary-trigger", "summaries");
        var reflectionTrigger = await host.GetTriggerAsync("missed-day-reflection-trigger", "reflections");

        weeklyTrigger.Should().NotBeNull();
        reflectionTrigger.Should().NotBeNull();

        // The weekly summary runs every hour on the hour (it picks users whose local time
        // is Sunday morning) — pinned to UTC explicitly, because Quartz otherwise interprets
        // cron expressions in server-local time.
        var weeklyCron = weeklyTrigger.Should().BeAssignableTo<ICronTrigger>().Subject;
        weeklyCron.CronExpressionString.Should().Be("0 0 * * * ?");
        weeklyCron.TimeZone.Should().Be(TimeZoneInfo.Utc);

        var reflectionCron = reflectionTrigger.Should().BeAssignableTo<ICronTrigger>().Subject;
        reflectionCron.CronExpressionString.Should().Be("0 0 * * * ?");
        reflectionCron.TimeZone.Should().Be(TimeZoneInfo.Utc);
    }

    [Fact]
    public async Task InitializeAsync_FillsNextReminderForExistingHabits_WithoutPerHabitTriggers()
    {
        var now = new DateTimeOffset(2027, 1, 15, 12, 0, 0, TimeSpan.Zero);
        await using var host = await IntegrationTestHost.CreateAsync(initialize: false, start: false, time: new FakeTimeProvider(now));
        await host.EnsureCreatedAsync();

        var keptUtc = new DateTime(2027, 1, 15, 13, 0, 0, DateTimeKind.Utc);
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Users.Add(new User { DiscordUserId = 42, Timezone = "Asia/Tokyo" });
            db.Habits.AddRange(
                new Habit { Id = 1, UserId = 42, Name = "Stretch", ReminderTime = new TimeOnly(9, 0) },
                new Habit { Id = 2, UserId = 42, Name = "Read", ReminderTime = new TimeOnly(9, 0), NextReminderUtc = keptUtc },
                new Habit { Id = 3, UserId = 42, Name = "Walk" });

            await db.SaveChangesAsync();
        });

        await AppHost.InitializeAsync(host.Host);
        await host.Host.StartAsync();

        var next = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits
            .OrderBy(h => h.Id).Select(h => h.NextReminderUtc).ToListAsync());

        // 09:00 in Tokyo (UTC+9) is 00:00 UTC; 12:00 UTC is already past it, so the next one is tomorrow.
        next[0].Should().Be(new DateTime(2027, 1, 16, 0, 0, 0));
        next[1].Should().Be(keptUtc);
        next[2].Should().BeNull();

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        var reminderTriggers = await scheduler.GetTriggerKeys(GroupMatcher<TriggerKey>.GroupEquals("reminders"));
        reminderTriggers.Should().ContainSingle().Which.Name.Should().Be("reminder-dispatch-trigger");
    }
}
