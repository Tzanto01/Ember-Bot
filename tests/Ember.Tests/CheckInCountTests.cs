using Ember.Bot.Modules;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

/// <summary>Times per day: a count reaching the target marks the day done, and a done day stays done when the target rises.</summary>
[Collection("Integration")]
public class CheckInCountTests
{
    private const ulong UserId = 1801;
    private static readonly DateOnly Today = new(2027, 1, 13);

    private static async Task<(IntegrationTestHost Host, int HabitId)> CreateAsync(int timesPerDay)
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 5, 12, 0, 0, TimeSpan.Zero));
        var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.GiveHealthDataConsentAsync(UserId);
            var userId = await service.FindDiscordUserAsync(UserId);
            return (await service.AddHabitAsync(userId, "Water", null, timesPerDay: timesPerDay)).Id;
        });
        time.SetUtcNow(new DateTimeOffset(2027, 1, 13, 12, 0, 0, TimeSpan.Zero));
        return (host, habitId);
    }

    private static Task<List<(DateOnly Date, int Count, bool Completed)>> LogsAsync(IntegrationTestHost host, int habitId)
        => host.WithScopeAsync(async sp => (await sp.GetRequiredService<EmberDbContext>().HabitLogs
                .Where(l => l.HabitId == habitId).OrderBy(l => l.Date).ToListAsync())
            .Select(l => (l.Date, l.Count, l.Completed)).ToList());

    [Fact]
    public async Task AddCheckIn_CountsUpToTheTarget_AndStopsThere()
    {
        var (host, habitId) = await CreateAsync(timesPerDay: 3);
        await using var _ = host;

        for (var i = 0; i < 2; i++)
            await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().AddCheckInAsync(UserId, habitId, Today));
        (await LogsAsync(host, habitId)).Should().Equal((Today, 2, false));

        for (var i = 0; i < 2; i++)
            await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().AddCheckInAsync(UserId, habitId, Today));
        (await LogsAsync(host, habitId)).Should().Equal((Today, 3, true));
    }

    [Fact]
    public async Task SetCountAndCheckIn_KeepCompletedInLineWithTheCount()
    {
        var (host, habitId) = await CreateAsync(timesPerDay: 2);
        await using var _ = host;
        var yesterday = Today.AddDays(-1);

        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var userId = await service.FindDiscordUserAsync(UserId);
            await service.SetCountAsync(userId, habitId, Today, 2);
            await service.SetCountAsync(userId, habitId, Today, 1);
            await service.CheckInAsync(userId, habitId, yesterday, completed: true);
        });
        (await LogsAsync(host, habitId)).Should().Equal((yesterday, 2, true), (Today, 1, false));

        var outOfRange = () => host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            return await service.SetCountAsync(await service.FindDiscordUserAsync(UserId), habitId, Today, 3);
        });
        await outOfRange.Should().ThrowAsync<ArgumentOutOfRangeException>();
        (await LogsAsync(host, habitId)).Should().Equal((yesterday, 2, true), (Today, 1, false));
    }

    [Fact]
    public async Task RaisingTimesPerDay_KeepsPastDoneDaysAndTheStreak_AndRecomputesOnlyToday()
    {
        var (host, habitId) = await CreateAsync(timesPerDay: 1);
        await using var _ = host;
        var days = Enumerable.Range(1, 3).Select(i => Today.AddDays(-i)).ToList();
        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            foreach (var day in days) await service.AddCheckInAsync(UserId, habitId, day);
            await service.AddCheckInAsync(UserId, habitId, Today);
        });
        var streak = () => host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var userId = await service.FindDiscordUserAsync(UserId);
            return HabitService.ConsecutiveStreak((await service.GetHabitAsync(userId, habitId))!, Today, 0).streak;
        });
        (await streak()).Should().Be(4);

        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().SetScheduleAsync(UserId, habitId, FrequencyType.Daily, null, null, 3));

        (await LogsAsync(host, habitId)).Should().Equal((days[2], 1, true), (days[1], 1, true), (days[0], 1, true), (Today, 1, false));
        (await streak()).Should().Be(3);
        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().AddCheckInAsync(UserId, habitId, days[0]));
        (await LogsAsync(host, habitId)).Should().Contain((days[0], 2, true));
    }

    [Fact]
    public async Task LoweringTimesPerDay_MakesPastCountsThatReachTheTargetDoneAndClampsThem()
    {
        var (host, habitId) = await CreateAsync(timesPerDay: 3);
        await using var _ = host;
        var yesterday = Today.AddDays(-1);
        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.AddCheckInAsync(UserId, habitId, yesterday);
            await service.AddCheckInAsync(UserId, habitId, yesterday);
            await service.AddCheckInAsync(UserId, habitId, Today);
        });

        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().SetScheduleAsync(UserId, habitId, FrequencyType.Daily, null, null, 2));
        (await LogsAsync(host, habitId)).Should().Equal((yesterday, 2, true), (Today, 1, false));

        var weekly = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().SetScheduleAsync(UserId, habitId, FrequencyType.Weekly, 2, null, 3));
        weekly!.TimesPerDay.Should().Be(1);
        (await LogsAsync(host, habitId)).Should().Equal((yesterday, 1, true), (Today, 1, true));
    }

    [Fact]
    public async Task ReminderDoneButton_AddsOneCheckIn()
    {
        var (host, habitId) = await CreateAsync(timesPerDay: 2);
        await using var _ = host;
        var sentUnix = new DateTimeOffset(2027, 1, 13, 9, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds().ToString();

        await host.WithScopeAsync(sp =>
            CheckInButtonModule.LogReminderDayAsync(sp.GetRequiredService<HabitService>(), UserId, habitId, sentUnix, completed: true, null));
        (await LogsAsync(host, habitId)).Should().Equal((Today, 1, false));

        await host.WithScopeAsync(sp =>
            CheckInButtonModule.LogReminderDayAsync(sp.GetRequiredService<HabitService>(), UserId, habitId, sentUnix, completed: true, null));
        (await LogsAsync(host, habitId)).Should().Equal((Today, 2, true));
    }

    [Fact]
    public async Task ReminderSkipButton_KeepsPartialProgress()
    {
        var (host, habitId) = await CreateAsync(timesPerDay: 3);
        await using var _ = host;
        var sentUnix = new DateTimeOffset(2027, 1, 13, 9, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds().ToString();
        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.AddCheckInAsync(UserId, habitId, Today);
            await service.AddCheckInAsync(UserId, habitId, Today);
        });

        await host.WithScopeAsync(sp =>
            CheckInButtonModule.LogReminderDayAsync(sp.GetRequiredService<HabitService>(), UserId, habitId, sentUnix, completed: false, null));

        (await LogsAsync(host, habitId)).Should().Equal((Today, 2, false));
    }
}
