using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;

namespace Ember.Tests;

public class MissedDayReflectionTests
{
    [Theory]
    [InlineData(2026, 1, 12)] // Monday
    [InlineData(2026, 1, 13)]
    [InlineData(2026, 1, 14)]
    [InlineData(2026, 1, 15)]
    [InlineData(2026, 1, 16)]
    [InlineData(2026, 1, 17)]
    [InlineData(2026, 1, 18)] // Sunday
    public void WeekStart_IsTheMondayOfTheSameWeek_ForEveryWeekday(int year, int month, int day)
    {
        var date = new DateOnly(year, month, day);

        HabitService.WeekStart(date).Should().Be(new DateOnly(2026, 1, 12));
    }

    [Fact]
    public void IsActiveOn_HabitCreatedToday_IsFalseForYesterday()
    {
        var habit = HabitFactory.Make(
            createdAtDaysAgo: 0,
            pausedUntilDaysAgo: null,
            frequency: FrequencyType.Daily,
            weeklyTarget: null);

        var yesterday = HabitFactory.Today.AddDays(-1);

        HabitService.IsActiveOn(habit, yesterday).Should().BeFalse();
    }

    [Fact]
    public void IsActiveOn_HabitCreatedYesterday_IsFalseForYesterday()
    {
        // A habit created on the evaluated day should never count as "missed" —
        // the user had no full day to complete it.
        var habit = HabitFactory.Make(
            createdAtDaysAgo: 1,
            pausedUntilDaysAgo: null,
            frequency: FrequencyType.Daily,
            weeklyTarget: null);

        var yesterday = HabitFactory.Today.AddDays(-1);

        HabitService.IsActiveOn(habit, yesterday).Should().BeFalse();
    }

    [Fact]
    public void IsActiveOn_HabitCreatedTwoDaysAgo_IsTrueForYesterday()
    {
        // A habit created strictly before the evaluated day IS active on that day.
        var habit = HabitFactory.Make(
            createdAtDaysAgo: 2,
            pausedUntilDaysAgo: null,
            frequency: FrequencyType.Daily,
            weeklyTarget: null);

        var yesterday = HabitFactory.Today.AddDays(-1);

        HabitService.IsActiveOn(habit, yesterday).Should().BeTrue();
    }

    [Fact]
    public void IsActiveOn_WeeklyHabitCreatedAfterWeekStart_IsFalseForEarlierDays()
    {
        var today = HabitFactory.Today;
        var createdAt = HabitFactory.Today.AddDays(-1);
        var earlierDay = createdAt.AddDays(-1);

        var habit = HabitFactory.Make(
            createdAtDaysAgo: 1,
            pausedUntilDaysAgo: null,
            frequency: FrequencyType.Weekly,
            weeklyTarget: 3,
            (0, true));

        HabitService.IsActiveOn(habit, earlierDay).Should().BeFalse();
        HabitService.IsActiveOn(habit, today).Should().BeTrue();
    }
}
