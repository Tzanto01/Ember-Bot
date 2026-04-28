using Ember.Bot;
using Ember.Bot.Data;
using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Quartz;

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
        (await scheduler.CheckExists(Ember.Bot.Jobs.ReminderJob.Key)).Should().BeTrue();

        var weeklyTrigger = await host.GetTriggerAsync("weekly-summary-trigger", "summaries");
        var reflectionTrigger = await host.GetTriggerAsync("missed-day-reflection-trigger", "reflections");

        weeklyTrigger.Should().NotBeNull();
        reflectionTrigger.Should().NotBeNull();
    }

    [Fact]
    public async Task InitializeAsync_RestoresReminderSchedulesFromDatabase()
    {
        await using var host = await IntegrationTestHost.CreateAsync(initialize: false, start: false);
        await host.EnsureCreatedAsync();

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Users.Add(new User { DiscordUserId = 42, Timezone = "Asia/Tokyo" });
            db.Habits.Add(new Habit
            {
                UserId = 42,
                Name = "Stretch",
                ReminderTime = new TimeOnly(9, 0),
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            });

            await db.SaveChangesAsync();
        });

        await AppHost.InitializeAsync(host.Host);
        await host.Host.StartAsync();

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        (await scheduler.CheckExists(new JobKey("habit-1", "reminders"))).Should().BeTrue();

        var trigger = await host.GetTriggerAsync("habit-1-trigger", "reminders");
        trigger.Should().BeAssignableTo<ICronTrigger>();
        ((ICronTrigger)trigger!).CronExpressionString.Should().Be("0 0 0 * * ?");
    }
}
