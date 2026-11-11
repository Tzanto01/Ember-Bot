using Ember.Bot.Modules;
using Ember.Core.Data;
using Ember.Core.Services;
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
    public async Task ReminderButton_TappedTheNextMorning_LogsTheLocalDayTheReminderWasSentFor()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 5, 20, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await AddHabitInLosAngelesAsync(host);
        // 06:00 UTC Jan 11 is 22:00 Jan 10 in Los Angeles.
        var sentUnix = new DateTimeOffset(2027, 1, 11, 6, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds().ToString();
        time.SetUtcNow(new DateTimeOffset(2027, 1, 11, 16, 0, 0, TimeSpan.Zero));

        var (result, day, _) = await host.WithScopeAsync(sp =>
            CheckInButtonModule.LogReminderDayAsync(sp.GetRequiredService<HabitService>(), UserId, habitId, sentUnix, completed: true, null));
        var days = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GetHabitDaysAsync(UserId, habitId, 2));

        result.Should().Be(DayEditResult.Saved);
        day.Should().Be(new DateOnly(2027, 1, 10));
        days!.Select(d => d.Completed).Should().Equal(true, null);
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
    public async Task NextMorningSkipButton_LeavesADoneDayDone()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 5, 20, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await AddHabitInLosAngelesAsync(host);
        var sentUnix = new DateTimeOffset(2027, 1, 11, 6, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds().ToString();
        time.SetUtcNow(new DateTimeOffset(2027, 1, 11, 16, 0, 0, TimeSpan.Zero));
        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().CheckInAsync(UserId, habitId, new DateOnly(2027, 1, 10), completed: true));

        var (result, _, keptDone) = await host.WithScopeAsync(sp =>
            CheckInButtonModule.LogReminderDayAsync(sp.GetRequiredService<HabitService>(), UserId, habitId, sentUnix, completed: false, null));
        var days = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GetHabitDaysAsync(UserId, habitId, 2));

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

        var snoozed = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().SnoozeReminderAsync(UserId, habitId, time.GetUtcNow()));
        var next = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits.Where(h => h.Id == habitId).Select(h => h.NextReminderUtc).SingleAsync());

        snoozed.Should().BeFalse();
        next.Should().BeNull();
    }

    [Fact]
    public async Task SnoozeButton_OnAReminderOlderThanTheSnoozeWindow_LeavesTheScheduleAlone()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 5, 20, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.GiveHealthDataConsentAsync(UserId);
            return (await service.AddHabitAsync(UserId, "Stretch", new TimeOnly(9, 0))).Id;
        });
        var before = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits.Where(h => h.Id == habitId).Select(h => h.NextReminderUtc).SingleAsync());

        var stale = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>()
            .SnoozeReminderAsync(UserId, habitId, time.GetUtcNow() - HabitService.SnoozeWindow - TimeSpan.FromMinutes(1)));
        var after = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits.Where(h => h.Id == habitId).Select(h => h.NextReminderUtc).SingleAsync());

        stale.Should().BeFalse();
        after.Should().Be(before);
    }

    private static Task<int> AddHabitInLosAngelesAsync(IntegrationTestHost host) => host.WithScopeAsync(async sp =>
    {
        var service = sp.GetRequiredService<HabitService>();
        await service.GiveHealthDataConsentAsync(UserId);
        var userId = await TestUsers.UserIdAsync(sp, UserId);
        await sp.GetRequiredService<EmberDbContext>().Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.Timezone, "America/Los_Angeles"));
        return (await service.AddHabitAsync(UserId, "Stretch", null)).Id;
    });

    [Fact]
    public async Task SkipButton_OnTodaysReminder_DropsThePendingSecondReminder()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 5, 20, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await AddHabitInLosAngelesAsync(host);
        time.SetUtcNow(new DateTimeOffset(2027, 1, 11, 18, 0, 0, TimeSpan.Zero));
        await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits.Where(h => h.Id == habitId)
            .ExecuteUpdateAsync(s => s.SetProperty(h => h.SecondReminderUtc, time.GetUtcNow().UtcDateTime.AddMinutes(30))));

        var (result, _, _) = await host.WithScopeAsync(sp => CheckInButtonModule.LogReminderDayAsync(sp.GetRequiredService<HabitService>(),
            UserId, habitId, time.GetUtcNow().ToUnixTimeSeconds().ToString(), completed: false, null));
        var second = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits.Where(h => h.Id == habitId)
            .Select(h => h.SecondReminderUtc).SingleAsync());

        result.Should().Be(DayEditResult.Saved);
        second.Should().BeNull();
    }

    [Fact]
    public async Task SnoozeButton_ThatWouldCrossLocalMidnight_IsRefused()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 5, 20, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await AddHabitInLosAngelesAsync(host);
        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().EditHabitAsync(UserId, habitId, null, new TimeOnly(23, 30), false));
        // 07:30 UTC Jan 12 is 23:30 Jan 11 in Los Angeles; an hour later is the next local day.
        time.SetUtcNow(new DateTimeOffset(2027, 1, 12, 7, 30, 0, TimeSpan.Zero));
        var before = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits.Where(h => h.Id == habitId).Select(h => h.NextReminderUtc).SingleAsync());

        var snoozed = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().SnoozeReminderAsync(UserId, habitId, time.GetUtcNow()));
        var after = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits.Where(h => h.Id == habitId).Select(h => h.NextReminderUtc).SingleAsync());

        snoozed.Should().BeFalse();
        after.Should().Be(before);
    }
}
