using Ember.Core.Data;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Integration")]
public class BackfillTests
{
    private const ulong UserId = 900;

    private static async Task<int> CreateHabitAsync(IntegrationTestHost host, string timezone)
        => await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.GiveHealthDataConsentAsync(UserId);
            await SetTimezoneAsync(sp, timezone);
            return (await service.AddHabitAsync(UserId, "Stretch", null)).Id;
        });

    private static async Task SetTimezoneAsync(IServiceProvider sp, string timezone)
    {
        var db = sp.GetRequiredService<EmberDbContext>();
        await db.Users.Where(u => u.DiscordUserId == (long)UserId).ExecuteUpdateAsync(s => s.SetProperty(u => u.Timezone, timezone));
    }

    private static Task<DayEditResult> CheckInAsync(IntegrationTestHost host, int habitId, DateOnly date, bool completed = true)
        => host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().CheckInAsync(UserId, habitId, date, completed));

    private static Task<List<(DateOnly Date, bool Completed)>> LogsAsync(IntegrationTestHost host, int habitId)
        => host.WithScopeAsync(async sp => (await sp.GetRequiredService<EmberDbContext>().HabitLogs
            .Where(l => l.HabitId == habitId).OrderBy(l => l.Date).ToListAsync())
            .Select(l => (l.Date, l.Completed)).ToList());

    [Fact]
    public async Task BackfillingPastDays_StoresThemOnThoseDates_AndHealsTheStreak()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 1, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await CreateHabitAsync(host, "Europe/Berlin");
        time.Advance(TimeSpan.FromDays(9));
        var today = new DateOnly(2027, 1, 10);

        foreach (var day in new[] { today, today.AddDays(-1), today.AddDays(-4), today.AddDays(-2), today.AddDays(-3) })
            (await CheckInAsync(host, habitId, day)).Should().Be(DayEditResult.Saved);

        var habit = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GetHabitAsync(UserId, habitId));
        HabitService.ConsecutiveStreak(habit!, today, graceDays: 0).streak.Should().Be(5);
    }

    [Fact]
    public async Task FutureDaysAndDaysBeforeTheHabitStarted_AreRejected_AndTheStartDayIsAllowed()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 1, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await CreateHabitAsync(host, "Europe/Berlin");
        time.Advance(TimeSpan.FromDays(3));

        (await CheckInAsync(host, habitId, new DateOnly(2027, 1, 5))).Should().Be(DayEditResult.InFuture);
        (await CheckInAsync(host, habitId, new DateOnly(2026, 12, 31))).Should().Be(DayEditResult.BeforeHabitStart);
        (await CheckInAsync(host, habitId, new DateOnly(2027, 1, 1))).Should().Be(DayEditResult.Saved);

        (await LogsAsync(host, habitId)).Should().Equal((new DateOnly(2027, 1, 1), true));
    }

    [Fact]
    public async Task EditingAPastDay_SetsDoneThenNotDoneThenClearsIt()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 1, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await CreateHabitAsync(host, "Europe/Berlin");
        time.Advance(TimeSpan.FromDays(5));
        var day = new DateOnly(2027, 1, 3);

        await CheckInAsync(host, habitId, day, completed: true);
        await CheckInAsync(host, habitId, day, completed: false);
        (await LogsAsync(host, habitId)).Should().Equal((day, false));

        var byStranger = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().ClearDayAsync(UserId + 1, habitId, day));
        var byOwner = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().ClearDayAsync(UserId, habitId, day));

        byStranger.Should().Be(DayEditResult.HabitNotFound);
        byOwner.Should().Be(DayEditResult.Saved);
        (await LogsAsync(host, habitId)).Should().BeEmpty();
    }

    [Fact]
    public async Task Backfill_AcrossATimezoneChange_UsesTheCurrentTimezoneForTheAllowedRange()
    {
        // Created at 11:00 UTC on Jan 10: already Jan 11 in Kiritimati (UTC+14), still Jan 10 in Los Angeles (UTC-8).
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 10, 11, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await CreateHabitAsync(host, "Pacific/Kiritimati");
        time.SetUtcNow(new DateTimeOffset(2027, 1, 14, 12, 0, 0, TimeSpan.Zero));

        (await CheckInAsync(host, habitId, new DateOnly(2027, 1, 15))).Should().Be(DayEditResult.Saved);
        (await CheckInAsync(host, habitId, new DateOnly(2027, 1, 10))).Should().Be(DayEditResult.BeforeHabitStart);

        await host.WithScopeAsync(sp => SetTimezoneAsync(sp, "America/Los_Angeles"));

        (await CheckInAsync(host, habitId, new DateOnly(2027, 1, 15))).Should().Be(DayEditResult.InFuture);
        (await CheckInAsync(host, habitId, new DateOnly(2027, 1, 10))).Should().Be(DayEditResult.Saved);
        (await LogsAsync(host, habitId)).Should().Equal((new DateOnly(2027, 1, 10), true), (new DateOnly(2027, 1, 15), true));
    }
}
