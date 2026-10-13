using Ember.Bot.Data;
using Ember.Bot.Modules;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Integration")]
public class ReminderButtonDayTests
{
    private const ulong UserId = 1701;

    [Fact]
    public async Task OldReminderButton_LogsTheLocalDayTheReminderWasSentFor()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 5, 20, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await AddHabitInLosAngelesAsync(host);
        // 06:00 UTC Jan 11 is 22:00 Jan 10 in Los Angeles.
        var sentUnix = new DateTimeOffset(2027, 1, 11, 6, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds().ToString();
        time.SetUtcNow(new DateTimeOffset(2027, 1, 13, 20, 0, 0, TimeSpan.Zero));

        var (result, day, _) = await host.WithScopeAsync(sp =>
            CheckInButtonModule.LogReminderDayAsync(sp.GetRequiredService<HabitService>(), UserId, habitId, sentUnix, completed: true, null));
        var days = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GetHabitDaysAsync(UserId, habitId, 4));

        result.Should().Be(DayEditResult.Saved);
        day.Should().Be(new DateOnly(2027, 1, 10));
        days!.Select(d => d.Completed).Should().Equal(true, null, null, null);
    }

    [Fact]
    public async Task ReminderButton_FromBeforeTheHabitStarted_IsRefused()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 5, 20, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await AddHabitInLosAngelesAsync(host);
        var sentUnix = new DateTimeOffset(2027, 1, 4, 20, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds().ToString();

        var (result, _, _) = await host.WithScopeAsync(sp =>
            CheckInButtonModule.LogReminderDayAsync(sp.GetRequiredService<HabitService>(), UserId, habitId, sentUnix, completed: true, null));

        result.Should().Be(DayEditResult.BeforeHabitStart);
    }

    [Fact]
    public async Task StaleSkipButton_LeavesADoneDayDone()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 5, 20, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await AddHabitInLosAngelesAsync(host);
        var sentUnix = new DateTimeOffset(2027, 1, 11, 6, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds().ToString();
        time.SetUtcNow(new DateTimeOffset(2027, 1, 13, 20, 0, 0, TimeSpan.Zero));
        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().CheckInAsync(UserId, habitId, new DateOnly(2027, 1, 10), completed: true));

        var (result, _, keptDone) = await host.WithScopeAsync(sp =>
            CheckInButtonModule.LogReminderDayAsync(sp.GetRequiredService<HabitService>(), UserId, habitId, sentUnix, completed: false, null));
        var days = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GetHabitDaysAsync(UserId, habitId, 4));

        result.Should().Be(DayEditResult.Saved);
        keptDone.Should().BeTrue();
        days![0].Completed.Should().BeTrue();
    }

    [Fact]
    public async Task SnoozeButton_ForAHabitWithoutAReminder_SchedulesNothing()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 5, 20, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await AddHabitInLosAngelesAsync(host);

        var snoozed = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().SnoozeReminderAsync(UserId, habitId));
        var next = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits.Where(h => h.Id == habitId).Select(h => h.NextReminderUtc).SingleAsync());

        snoozed.Should().BeFalse();
        next.Should().BeNull();
    }

    private static Task<int> AddHabitInLosAngelesAsync(IntegrationTestHost host) => host.WithScopeAsync(async sp =>
    {
        var service = sp.GetRequiredService<HabitService>();
        await service.GiveHealthDataConsentAsync(UserId);
        await sp.GetRequiredService<EmberDbContext>().Users
            .Where(u => u.DiscordUserId == (long)UserId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.Timezone, "America/Los_Angeles"));
        return (await service.AddHabitAsync(UserId, "Stretch", null)).Id;
    });
}
