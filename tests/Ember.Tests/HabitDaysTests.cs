using Ember.Bot.Data;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Integration")]
public class HabitDaysTests
{
    private const ulong UserId = 990;

    [Fact]
    public async Task GetHabitDays_ReportsEachLocalDayOldestFirst()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 10, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.GiveHealthDataConsentAsync(UserId);
            return (await service.AddHabitAsync(UserId, "Stretch", null)).Id;
        });
        time.SetUtcNow(new DateTimeOffset(2027, 1, 18, 12, 0, 0, TimeSpan.Zero));
        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.CheckInAsync(UserId, habitId, new DateOnly(2027, 1, 10), completed: true);
            await service.CheckInAsync(UserId, habitId, new DateOnly(2027, 1, 11), completed: false);
            await service.SetLowDayAsync(UserId, new DateOnly(2027, 1, 13));
            await service.CheckInAsync(UserId, habitId, new DateOnly(2027, 1, 17), completed: false);
            await sp.GetRequiredService<EmberDbContext>().Habits.Where(h => h.Id == habitId).ExecuteUpdateAsync(s => s
                .SetProperty(h => h.PausedFrom, new DateOnly(2027, 1, 14))
                .SetProperty(h => h.PausedUntil, new DateOnly(2027, 1, 15)));
        });

        var days = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GetHabitDaysAsync(UserId, habitId, 10));

        days.Should().Equal(
            new HabitDay(new DateOnly(2027, 1, 9), DayState.BeforeStart, null),
            new HabitDay(new DateOnly(2027, 1, 10), DayState.Done, true),
            new HabitDay(new DateOnly(2027, 1, 11), DayState.NotDone, false),
            new HabitDay(new DateOnly(2027, 1, 12), DayState.NotDone, null),
            new HabitDay(new DateOnly(2027, 1, 13), DayState.LowDay, null),
            new HabitDay(new DateOnly(2027, 1, 14), DayState.Paused, null),
            new HabitDay(new DateOnly(2027, 1, 15), DayState.Paused, null),
            new HabitDay(new DateOnly(2027, 1, 16), DayState.NotDone, null),
            new HabitDay(new DateOnly(2027, 1, 17), DayState.Pending, false),
            new HabitDay(new DateOnly(2027, 1, 18), DayState.Pending, null));
    }

    [Fact]
    public async Task GetHabitDays_ForSomeoneElsesHabit_ReturnsNull()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(new DateTimeOffset(2027, 1, 10, 12, 0, 0, TimeSpan.Zero)));
        var habitId = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.GiveHealthDataConsentAsync(UserId);
            return (await service.AddHabitAsync(UserId, "Stretch", null)).Id;
        });

        (await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GetHabitDaysAsync(UserId + 1, habitId, 14))).Should().BeNull();
    }
}
