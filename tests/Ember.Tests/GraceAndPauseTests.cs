using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

public class GraceAndPauseTests
{
    private static readonly DateOnly Today = HabitFactory.Today;

    private static Habit DoneEveryDayExcept(int days, params int[] gapsDaysAgo)
        => HabitFactory.Make(Enumerable.Range(0, days).Where(d => !gapsDaysAgo.Contains(d)).Select(d => (d, true)).ToArray());

    [Fact]
    public void GraceDays_ApplyPerRolling7DayWindow_SoGapsMoreThanAWeekApartAreBothForgiven()
    {
        var habit = DoneEveryDayExcept(16, 3, 11);

        HabitService.ConsecutiveStreak(habit, Today, graceDays: 1).Should().Be((14, 2));
    }

    [Fact]
    public void GraceDays_NoWindowMayHoldMoreForgivenGapsThanAllowed()
    {
        var habit = DoneEveryDayExcept(16, 3, 8);

        HabitService.ConsecutiveStreak(habit, Today, graceDays: 1).Should().Be((7, 1));
        HabitService.ConsecutiveStreak(habit, Today, graceDays: 2).Should().Be((14, 2));
    }

    [Fact]
    public void BestStreak_HonorsGraceDays()
    {
        var habit = HabitFactory.Make(Enumerable.Range(20, 11).Where(d => d != 25).Select(d => (d, true)).ToArray());

        HabitService.BestStreak(habit, Today, graceDays: 0).Should().Be(5);
        HabitService.BestStreak(habit, Today, graceDays: 1).Should().Be(10);
    }

    [Fact]
    public void BestStreak_HonorsLowDaysPausesAndTheSwitchoverDate()
    {
        var s = TimezoneHelper.SwitchoverDate;
        var habit = new Habit { Name = "Test", CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) };
        foreach (var d in new[] { -6, -5, -3, -1, 1, 2, 4, 5 })
            habit.Logs.Add(new HabitLog { Date = s.AddDays(d), Completed = true });
        habit.PausedFrom = s.AddDays(3);
        habit.PausedUntil = s.AddDays(3);
        var lowDays = new HashSet<DateOnly> { s.AddDays(-4), s.AddDays(-2) };

        HabitService.BestStreak(habit, s.AddDays(30), graceDays: 0).Should().Be(5);
        HabitService.BestStreak(habit, s.AddDays(30), graceDays: 0, lowDays).Should().Be(8);
    }

    [Fact]
    public void BestStreak_IsNeverBelowTheCurrentStreak()
    {
        var habit = DoneEveryDayExcept(16, 3, 11);

        HabitService.BestStreak(habit, Today, graceDays: 1).Should().Be(14);
    }

    [Fact]
    public void Pause_ExcludesOnlyThePausedRange()
    {
        var habit = HabitFactory.Make((0, true), (1, true), (2, true), (6, true), (7, true), (8, true));
        habit.PausedFrom = Today.AddDays(-5);
        habit.PausedUntil = Today.AddDays(-3);

        HabitService.IsPausedOn(habit, Today.AddDays(-6)).Should().BeFalse();
        HabitService.IsPausedOn(habit, Today.AddDays(-5)).Should().BeTrue();
        HabitService.IsPausedOn(habit, Today.AddDays(-3)).Should().BeTrue();
        HabitService.IsPausedOn(habit, Today.AddDays(-2)).Should().BeFalse();
        HabitService.ConsecutiveStreak(habit, Today, graceDays: 0).streak.Should().Be(6);
    }

    [Fact]
    public void Pause_AGapJustBeforeThePausedRange_StillCounts()
    {
        var habit = HabitFactory.Make((0, true), (1, true), (2, true), (7, true), (8, true));
        habit.PausedFrom = Today.AddDays(-5);
        habit.PausedUntil = Today.AddDays(-3);

        HabitService.ConsecutiveStreak(habit, Today, graceDays: 0).streak.Should().Be(3);
    }
}

[Collection("Integration")]
public class PauseServiceTests
{
    private const ulong UserId = 970;

    [Fact]
    public async Task Pausing_StartsTheRangeToday_AndResumingKeepsThePastPausedDaysProtected()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 10, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var habitId = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.GiveHealthDataConsentAsync(UserId);
            return (await service.AddHabitAsync(UserId, "Stretch", null)).Id;
        });

        time.Advance(TimeSpan.FromDays(5));
        var paused = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().PauseHabitAsync(UserId, habitId, new DateOnly(2027, 1, 21)));
        paused!.PausedFrom.Should().Be(new DateOnly(2027, 1, 15));

        time.Advance(TimeSpan.FromDays(3));
        var resumed = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().PauseHabitAsync(UserId, habitId, null));

        resumed!.PausedFrom.Should().Be(new DateOnly(2027, 1, 15));
        resumed.PausedUntil.Should().Be(new DateOnly(2027, 1, 17));
        HabitService.IsPausedOn(resumed, new DateOnly(2027, 1, 18)).Should().BeFalse();
    }

    [Fact]
    public async Task PausingAndResumingOnTheSameDay_LeavesNoPausedRange()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 10, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        var resumed = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.GiveHealthDataConsentAsync(UserId);
            var habit = await service.AddHabitAsync(UserId, "Stretch", null);
            await service.PauseHabitAsync(UserId, habit.Id, new DateOnly(2027, 1, 10));
            return await service.PauseHabitAsync(UserId, habit.Id, null);
        });

        resumed!.PausedFrom.Should().BeNull();
        resumed.PausedUntil.Should().BeNull();
    }
}
