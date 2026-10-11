using Discord;
using Ember.Bot.Data;
using Ember.Bot.Jobs;
using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Integration")]
public class ReminderDispatchTests
{
    private const string Berlin = "Europe/Berlin";

    // Friday 2027-01-15, 09:00 in Berlin (UTC+1).
    private static readonly DateTimeOffset Now = new(2027, 1, 15, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly Today = new(2027, 1, 15);
    private static readonly DateTime TomorrowNineBerlin = new(2027, 1, 16, 8, 0, 0, DateTimeKind.Utc);
    private static readonly TimeOnly Nine = new(9, 0);

    private static async Task<IntegrationTestHost> CreateHostAsync(FakeTimeProvider time, params Habit[] habits)
    {
        var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            foreach (var userId in habits.Select(h => h.UserId).Distinct())
                db.Users.Add(new User { DiscordUserId = userId, Timezone = Berlin });
            db.Habits.AddRange(habits);
            await db.SaveChangesAsync();
        });
        return host;
    }

    private static Habit DueHabit(int id, long userId, DateTime? nextUtc = null) => new()
    {
        Id = id,
        UserId = userId,
        Name = $"Habit {id}",
        ReminderTime = Nine,
        NextReminderUtc = nextUtc ?? Now.UtcDateTime,
        CreatedAt = Now.UtcDateTime.AddDays(-30)
    };

    private static Task RunJobAsync(IntegrationTestHost host)
        => ActivatorUtilities.CreateInstance<ReminderDispatchJob>(host.Host.Services).RunAsync();

    private static Task<DateTime?> NextReminderAsync(IntegrationTestHost host, int habitId)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits
            .Where(h => h.Id == habitId).Select(h => h.NextReminderUtc).SingleAsync());

    [Fact]
    public async Task DueReminder_IsSentWithCheckInButtons_AndAdvancesToTheNextLocalOccurrence()
    {
        await using var host = await CreateHostAsync(new FakeTimeProvider(Now), DueHabit(1, 10));

        await RunJobAsync(host);

        var dm = host.Discord.Messages.Should().ContainSingle().Subject;
        dm.UserId.Should().Be(10);
        dm.Text.Should().Contain("Habit 1").And.Contain("Did you follow this habit today?");
        dm.Components!.Components.OfType<ActionRowComponent>().SelectMany(row => row.Components)
            .OfType<ButtonComponent>().Select(b => b.CustomId)
            .Should().Equal($"checkin:done:1:{Now.ToUnixTimeSeconds()}",
                            $"checkin:skip:1:{Now.ToUnixTimeSeconds()}",
                            $"checkin:snooze:1:{Now.ToUnixTimeSeconds()}");
        (await NextReminderAsync(host, 1)).Should().Be(TomorrowNineBerlin);

        await RunJobAsync(host);
        host.Discord.Messages.Should().ContainSingle();
    }

    [Fact]
    public async Task ReminderOverdueByMoreThanTwoHours_IsAdvancedWithoutSending()
    {
        await using var host = await CreateHostAsync(new FakeTimeProvider(Now),
            DueHabit(1, 10, Now.UtcDateTime.AddHours(-2).AddMinutes(-1)),
            DueHabit(2, 20, Now.UtcDateTime.AddHours(-2)));

        await RunJobAsync(host);

        host.Discord.Messages.Should().ContainSingle().Which.UserId.Should().Be(20);
        (await NextReminderAsync(host, 1)).Should().Be(TomorrowNineBerlin);
        (await NextReminderAsync(host, 2)).Should().Be(TomorrowNineBerlin);
    }

    [Fact]
    public async Task PausedOrAlreadyCompletedToday_IsAdvancedWithoutSending()
    {
        var paused = DueHabit(1, 10);
        paused.PausedUntil = Today;
        var done = DueHabit(2, 10);
        done.Logs.Add(new HabitLog { Date = Today, Completed = true });
        var skipped = DueHabit(3, 10);
        skipped.Logs.Add(new HabitLog { Date = Today, Completed = false });

        await using var host = await CreateHostAsync(new FakeTimeProvider(Now), paused, done, skipped);

        await RunJobAsync(host);

        host.Discord.Messages.Should().ContainSingle().Which.Text.Should().Contain("Habit 3");
        (await NextReminderAsync(host, 1)).Should().Be(TomorrowNineBerlin);
        (await NextReminderAsync(host, 2)).Should().Be(TomorrowNineBerlin);
    }

    [Fact]
    public async Task Snooze_SendsAgainAfterAnHour_ThenReturnsToTheDailyTime()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, DueHabit(1, 10, TomorrowNineBerlin));

        var snoozed = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().SnoozeReminderAsync(10, 1));
        var othersSnooze = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().SnoozeReminderAsync(99, 1));

        snoozed.Should().BeTrue();
        othersSnooze.Should().BeFalse();
        (await NextReminderAsync(host, 1)).Should().Be(Now.UtcDateTime.AddMinutes(60));

        time.Advance(TimeSpan.FromMinutes(59));
        await RunJobAsync(host);
        host.Discord.Messages.Should().BeEmpty();

        time.Advance(TimeSpan.FromMinutes(1));
        await RunJobAsync(host);

        host.Discord.Messages.Should().ContainSingle().Which.Text.Should().Contain("Snoozed reminder").And.Contain("Habit 1");
        (await NextReminderAsync(host, 1)).Should().Be(TomorrowNineBerlin);
    }

    [Fact]
    public async Task FailingHabit_DoesNotBlockOthers_AndIsStillAdvanced()
    {
        await using var host = await CreateHostAsync(new FakeTimeProvider(Now), DueHabit(1, 10), DueHabit(2, 20));
        host.Discord.Deliver = userId => userId == 10 ? throw new HttpRequestException("boom") : DeliveryOutcome.Delivered;

        await RunJobAsync(host);

        host.Discord.Messages.Select(m => m.UserId).Should().BeEquivalentTo([10UL, 20UL]);
        (await NextReminderAsync(host, 1)).Should().Be(TomorrowNineBerlin);
        (await NextReminderAsync(host, 2)).Should().Be(TomorrowNineBerlin);
    }

    private static Task<User> UserAsync(IntegrationTestHost host, long userId)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users.SingleAsync(u => u.DiscordUserId == userId));

    [Fact]
    public async Task ThreeUndeliverableReminders_PauseDmReminders_UntilTheUserIsReachableAgain()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, DueHabit(1, 10));
        host.Discord.Deliver = _ => DeliveryOutcome.Undeliverable;

        for (var day = 0; day < 4; day++)
        {
            await RunJobAsync(host);
            time.Advance(TimeSpan.FromDays(1));
        }

        host.Discord.Messages.Should().HaveCount(3);
        (await UserAsync(host, 10)).DmRemindersPausedAt.Should().NotBeNull();
        (await NextReminderAsync(host, 1)).Should().Be(TomorrowNineBerlin.AddDays(3));

        var notices = new List<bool>();
        for (var i = 0; i < 2; i++)
            notices.Add(await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().ClaimDmPauseNoticeAsync(10)));
        notices.Should().Equal(true, false);

        host.Discord.Deliver = _ => DeliveryOutcome.Delivered;
        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().ResumeDmRemindersAsync(10));
        await RunJobAsync(host);

        host.Discord.Messages.Should().HaveCount(4);
        (await UserAsync(host, 10)).DmRemindersPausedAt.Should().BeNull();
    }

    [Fact]
    public async Task DeliveredReminder_ResetsTheConsecutiveFailureCount()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, DueHabit(1, 10));
        var outcomes = new Queue<DeliveryOutcome>([
            DeliveryOutcome.Undeliverable, DeliveryOutcome.Undeliverable, DeliveryOutcome.Delivered,
            DeliveryOutcome.Undeliverable, DeliveryOutcome.Undeliverable]);
        host.Discord.Deliver = _ => outcomes.Dequeue();

        for (var day = 0; day < 5; day++)
        {
            await RunJobAsync(host);
            time.Advance(TimeSpan.FromDays(1));
        }

        host.Discord.Messages.Should().HaveCount(5);
        var user = await UserAsync(host, 10);
        user.DmFailureCount.Should().Be(2);
        user.DmRemindersPausedAt.Should().BeNull();
    }

    [Fact]
    public async Task ReminderChanges_KeepNextReminderInSyncWithTimeAndTimezone()
    {
        await using var host = await CreateHostAsync(new FakeTimeProvider(Now));

        var habit = await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Users.Add(new User { DiscordUserId = 10, Timezone = Berlin });
            await db.SaveChangesAsync();
            return await sp.GetRequiredService<HabitService>().AddHabitAsync(10, "Stretch", new TimeOnly(10, 0));
        });
        (await NextReminderAsync(host, habit.Id)).Should().Be(new DateTime(2027, 1, 15, 9, 0, 0));

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            (await db.Users.SingleAsync()).Timezone = "Asia/Tokyo";
            await db.SaveChangesAsync();
            await sp.GetRequiredService<HabitService>().RescheduleRemindersAsync(10);
        });
        (await NextReminderAsync(host, habit.Id)).Should().Be(new DateTime(2027, 1, 16, 1, 0, 0));

        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>()
            .EditHabitAsync(10, habit.Id, newName: null, newReminderTime: null, clearReminder: true));
        (await NextReminderAsync(host, habit.Id)).Should().BeNull();
    }
}
