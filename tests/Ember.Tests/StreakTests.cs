using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;

namespace Ember.Tests;

public class StreakTests
{
    // ── FlexibleStreak ────────────────────────────────────────────────────────

    [Fact]
    public void FlexibleStreak_NoLogs_ReturnsZero()
    {
        var habit = HabitFactory.Make();
        HabitService.FlexibleStreak(habit).Should().Be(0);
    }

    [Fact]
    public void FlexibleStreak_AllCompletedLastSevenDays_ReturnsSeven()
    {
        var habit = HabitFactory.Make(
            (0, true), (1, true), (2, true), (3, true), (4, true), (5, true), (6, true));
        HabitService.FlexibleStreak(habit, 7).Should().Be(7);
    }

    [Fact]
    public void FlexibleStreak_ThreeOutOfSevenCompleted_ReturnsThree()
    {
        var habit = HabitFactory.Make(
            (0, true), (1, false), (2, true), (3, false), (4, true), (5, false), (6, false));
        HabitService.FlexibleStreak(habit, 7).Should().Be(3);
    }

    [Fact]
    public void FlexibleStreak_IgnoresLogsOlderThanWindow()
    {
        var habit = HabitFactory.Make(
            (0, true), (8, true), (9, true)); // days 8 & 9 are outside the 7-day window
        HabitService.FlexibleStreak(habit, 7).Should().Be(1);
    }

    [Fact]
    public void FlexibleStreak_OnlySkippedLogs_ReturnsZero()
    {
        var habit = HabitFactory.Make((0, false), (1, false), (2, false));
        HabitService.FlexibleStreak(habit, 7).Should().Be(0);
    }

    [Fact]
    public void FlexibleStreak_RespectsCustomWindow()
    {
        var habit = HabitFactory.Make(
            (0, true), (1, true), (2, true),
            (8, true), (9, true)); // 3 in last 7 days, 5 in last 30 days
        HabitService.FlexibleStreak(habit, 7).Should().Be(3);
        HabitService.FlexibleStreak(habit, 30).Should().Be(5);
    }

    // ── BestStreak ────────────────────────────────────────────────────────────

    [Fact]
    public void BestStreak_NoLogs_ReturnsZero()
    {
        var habit = HabitFactory.Make();
        HabitService.BestStreak(habit).Should().Be(0);
    }

    [Fact]
    public void BestStreak_SingleDay_ReturnsOne()
    {
        var habit = HabitFactory.Make((0, true));
        HabitService.BestStreak(habit).Should().Be(1);
    }

    [Fact]
    public void BestStreak_AllConsecutive_ReturnsCount()
    {
        var habit = HabitFactory.Make(
            (0, true), (1, true), (2, true), (3, true), (4, true));
        HabitService.BestStreak(habit).Should().Be(5);
    }

    [Fact]
    public void BestStreak_BrokenStreak_ReturnsLongestRun()
    {
        // 3 consecutive, gap, 2 consecutive — best should be 3
        var habit = HabitFactory.Make(
            (0, true), (1, true), (2, true),
            (4, true), (5, true));
        HabitService.BestStreak(habit).Should().Be(3);
    }

    [Fact]
    public void BestStreak_SkippedLogsDoNotCountTowardStreak()
    {
        // day 2+3 completed consecutively = 2, day 0 alone = 1 — best is 2
        var habit = HabitFactory.Make(
            (0, true), (1, false), (2, true), (3, true));
        HabitService.BestStreak(habit).Should().Be(2);
    }

    [Fact]
    public void BestStreak_MultipleEqualRuns_ReturnsCorrectMax()
    {
        var habit = HabitFactory.Make(
            (0, true), (1, true),
            (3, true), (4, true),
            (6, true), (7, true));
        HabitService.BestStreak(habit).Should().Be(2);
    }
}
