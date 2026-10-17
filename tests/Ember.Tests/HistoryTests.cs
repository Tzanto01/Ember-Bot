using Discord;
using Ember.Bot.Modules;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Integration")]
public class HistoryTests
{
    private const ulong UserId = 4242;
    private const int HabitId = 7;

    private static List<ActionRowComponent> Rows(MessageComponent components) =>
        components.Components.OfType<ActionRowComponent>().ToList();

    private static List<ButtonComponent> Buttons(MessageComponent components) =>
        Rows(components).SelectMany(r => r.Components).OfType<ButtonComponent>().ToList();

    [Fact]
    public void BuildGrid_ShowsEachDayStateAsAGentleButton()
    {
        var days = new List<HabitDay>
        {
            new(new DateOnly(2027, 1, 4), DayState.BeforeStart, null),
            new(new DateOnly(2027, 1, 5), DayState.Done, true),
            new(new DateOnly(2027, 1, 6), DayState.NotDone, false),
            new(new DateOnly(2027, 1, 7), DayState.NotDone, null),
            new(new DateOnly(2027, 1, 8), DayState.LowDay, null),
            new(new DateOnly(2027, 1, 9), DayState.LowDay, true),
            new(new DateOnly(2027, 1, 10), DayState.Paused, null),
            new(new DateOnly(2027, 1, 11), DayState.Pending, null),
        };

        var buttons = Buttons(HistoryModule.BuildGrid(UserId, HabitId, days, new HashSet<DateOnly>()));

        buttons.Select(b => b.Label).Should().Equal(
            "Mon 4", "Tue 5 ✅", "Wed 6 ➖", "Thu 7 ▫️", "Fri 8 🌙", "Sat 9 🌙✅", "Sun 10 ⏸️", "Mon 11 ▫️");
        buttons.Select(b => b.IsDisabled).Should().Equal(true, false, false, false, false, false, false, false);
        buttons.Should().NotContain(b => b.Style == ButtonStyle.Danger);
        buttons[1].CustomId.Should().Be($"history:day:{UserId}:{HabitId}:20270105");
    }

    [Fact]
    public void BuildGrid_FourteenDays_FitsInFourRowsWithALowDayMenu()
    {
        var today = new DateOnly(2027, 1, 20);
        var days = Enumerable.Range(0, HistoryModule.Days)
            .Select(i => new HabitDay(today.AddDays(i - HistoryModule.Days + 1), DayState.NotDone, null))
            .ToList();

        var grid = HistoryModule.BuildGrid(UserId, HabitId, days, new HashSet<DateOnly> { today.AddDays(-3) });

        Rows(grid).Should().HaveCount(4);
        Rows(grid).Should().OnlyContain(r => r.Components.Count <= 5);
        Buttons(grid).Should().HaveCount(14);
        var menu = Rows(grid).SelectMany(r => r.Components).OfType<SelectMenuComponent>().Single();
        menu.CustomId.Should().Be($"history:low:{UserId}:{HabitId}");
        menu.Options.Should().HaveCount(14);
        menu.Options.Single(o => o.Value == "20270117").Description.Should().Contain("low day");
        menu.Options.Where(o => o.Value != "20270117").Should().OnlyContain(o => o.Description == null);
    }

    [Fact]
    public async Task CycleDay_GoesFromNotLoggedToDoneToNotDoneAndBack()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 10, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await AddHabitAsync(host);
        time.SetUtcNow(new DateTimeOffset(2027, 1, 15, 12, 0, 0, TimeSpan.Zero));
        var day = new DateOnly(2027, 1, 12);

        var seen = new List<bool?>();
        for (var tap = 0; tap < 3; tap++)
        {
            await host.WithScopeAsync(sp => HistoryModule.CycleDayAsync(sp.GetRequiredService<HabitService>(), UserId, habitId, day, null));
            seen.Add(await host.WithScopeAsync(async sp =>
                (await sp.GetRequiredService<HabitService>().GetHabitDaysAsync(UserId, habitId, 4))![0].Completed));
        }

        seen.Should().Equal(true, false, null);
    }

    [Fact]
    public async Task CycleDay_BeforeTheHabitStarted_IsRefused()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 10, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await AddHabitAsync(host);

        var result = await host.WithScopeAsync(sp =>
            HistoryModule.CycleDayAsync(sp.GetRequiredService<HabitService>(), UserId, habitId, new DateOnly(2027, 1, 9), null));

        result.Should().Be(DayEditResult.BeforeHabitStart);
    }

    [Fact]
    public async Task ToggleLowDay_SetsThenClears_AndNeedsConsent()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 10, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var day = new DateOnly(2027, 1, 8);

        var withoutConsent = await host.WithScopeAsync(sp => HistoryModule.ToggleLowDayAsync(sp.GetRequiredService<HabitService>(), UserId, day));
        await AddHabitAsync(host);
        await host.WithScopeAsync(sp => HistoryModule.ToggleLowDayAsync(sp.GetRequiredService<HabitService>(), UserId, day));
        var afterSet = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GetLowDaysAsync(UserId));
        await host.WithScopeAsync(sp => HistoryModule.ToggleLowDayAsync(sp.GetRequiredService<HabitService>(), UserId, day));
        var afterClear = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GetLowDaysAsync(UserId));

        withoutConsent.Should().Be(DayEditResult.ConsentRequired);
        afterSet.Should().Equal(day);
        afterClear.Should().BeEmpty();
    }

    [Fact]
    public async Task FixingLastWeekFromTheHistoryGrid_GivesTheHandCalculatedStreak()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 5, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await AddHabitAsync(host);
        time.SetUtcNow(new DateTimeOffset(2027, 1, 20, 12, 0, 0, TimeSpan.Zero));

        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            foreach (var d in new[] { 13, 14, 15, 17, 18, 19 })
                await HistoryModule.CycleDayAsync(service, UserId, habitId, new DateOnly(2027, 1, d), null);
            for (var tap = 0; tap < 3; tap++)
                await HistoryModule.CycleDayAsync(service, UserId, habitId, new DateOnly(2027, 1, 12), null);
            await HistoryModule.ToggleLowDayAsync(service, UserId, new DateOnly(2027, 1, 16));
        });

        var (streak, graceUsed, last7) = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var habit = (await service.GetHabitAsync(UserId, habitId))!;
            var today = await service.GetLocalTodayAsync(UserId);
            var lowDays = await service.GetLowDaysAsync(UserId);
            var (s, g) = HabitService.ConsecutiveStreak(habit, today, await service.GetGraceDaysAsync(UserId), lowDays);
            return (s, g, HabitService.FlexibleStreak(habit, today, 7, lowDays));
        });

        streak.Should().Be(6);
        graceUsed.Should().Be(0);
        last7.Should().Be(6);
    }

    private static Task<int> AddHabitAsync(IntegrationTestHost host) => host.WithScopeAsync(async sp =>
    {
        var service = sp.GetRequiredService<HabitService>();
        await service.GiveHealthDataConsentAsync(UserId);
        return (await service.AddHabitAsync(UserId, "Stretch", null)).Id;
    });
}
