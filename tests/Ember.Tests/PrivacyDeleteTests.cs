using Ember.Bot.Jobs;
using Ember.Bot.Modules;
using Ember.Bot.Services;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;
using Quartz;

namespace Ember.Tests;

[Collection("Integration")]
public class PrivacyDeleteTests
{
    private static readonly DateOnly Day = new(2027, 1, 15);

    private static async Task<IntegrationTestHost> CreateHostWithTwoUsersAsync()
    {
        var host = await IntegrationTestHost.CreateAsync(start: false);
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            foreach (var userId in new long[] { 1, 2 })
            {
                var user = new User { DiscordUserId = userId, Timezone = "Europe/Berlin" };
                for (var i = 0; i < 2; i++)
                {
                    var habit = new Habit { Name = $"Habit {userId}-{i}", ReminderTime = new TimeOnly(9, 0), NextReminderUtc = DateTime.UtcNow };
                    habit.Logs.Add(new HabitLog { Date = Day, Completed = true });
                    habit.Logs.Add(new HabitLog { Date = Day.AddDays(-1), Completed = false });
                    user.Habits.Add(habit);
                }
                db.Users.Add(user);
            }
            await db.SaveChangesAsync();
        });
        return host;
    }

    private static Task<(int Users, int Habits, int Logs)> CountsForAsync(IntegrationTestHost host, long userId)
        => host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            return (await db.Users.CountAsync(u => u.DiscordUserId == userId),
                    await db.Habits.CountAsync(h => h.UserId == userId),
                    await db.HabitLogs.CountAsync(l => l.Habit.UserId == userId));
        });

    [Fact]
    public async Task ConfirmByOwner_DeletesTheUserWithAllHabitsAndLogs_AndLeavesOthersUntouched()
    {
        await using var host = await CreateHostWithTwoUsersAsync();

        var deleted = await host.WithScopeAsync(sp =>
            PrivacyModule.TryDeleteAsync(sp.GetRequiredService<HabitService>(), "1", clickerId: 1));

        deleted.Should().BeTrue();
        (await CountsForAsync(host, 1)).Should().Be((0, 0, 0));
        (await CountsForAsync(host, 2)).Should().Be((1, 2, 4));
        var orphanLogs = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().HabitLogs.CountAsync());
        orphanLogs.Should().Be(4);
    }

    [Theory]
    [InlineData("weekly")]
    [InlineData("reflection")]
    public async Task UserDeletedWhileAJobIsSendingDms_GetsNoMessage(string job)
    {
        var (now, key, created, withLogs) = job == "weekly"
            ? (new DateTimeOffset(2026, 1, 18, 9, 0, 0, TimeSpan.Zero), WeeklySummaryJob.Key, -8, true)
            : (new DateTimeOffset(2026, 1, 14, 10, 0, 0, TimeSpan.Zero), MissedDayReflectionJob.Key, -5, false);
        await using var host = await IntegrationTestHost.CreateAsync(time: new FakeTimeProvider(now));

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            foreach (var userId in new long[] { 1, 2 })
            {
                var habit = new Habit { Name = $"Habit {userId}", CreatedAt = now.UtcDateTime.AddDays(created) };
                if (withLogs)
                    habit.Logs.Add(new HabitLog { Date = DateOnly.FromDateTime(now.UtcDateTime).AddDays(-1), Completed = true });
                var user = new User { DiscordUserId = userId, Timezone = "UTC" };
                user.Habits.Add(habit);
                db.Users.Add(user);
            }
            await db.SaveChangesAsync();
        });

        var first = true;
        host.Discord.Deliver = recipient =>
        {
            if (first)
            {
                first = false;
                host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users
                    .Where(u => u.DiscordUserId != (long)recipient).ExecuteDeleteAsync()).GetAwaiter().GetResult();
            }
            return DeliveryOutcome.Delivered;
        };

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(key);
        await host.WaitForDmCountAsync(1);
        var deadline = Environment.TickCount64 + 3000;
        while ((await scheduler.GetCurrentlyExecutingJobs()).Any(j => j.JobDetail.Key.Equals(key)) && Environment.TickCount64 < deadline)
            await Task.Delay(20);

        host.Discord.Messages.Should().ContainSingle();
    }

    [Fact]
    public async Task ConfirmByAnotherUser_DeletesNothing()
    {
        await using var host = await CreateHostWithTwoUsersAsync();

        var deleted = await host.WithScopeAsync(sp =>
            PrivacyModule.TryDeleteAsync(sp.GetRequiredService<HabitService>(), "1", clickerId: 2));

        deleted.Should().BeFalse();
        (await CountsForAsync(host, 1)).Should().Be((1, 2, 4));
        (await CountsForAsync(host, 2)).Should().Be((1, 2, 4));
    }
}
