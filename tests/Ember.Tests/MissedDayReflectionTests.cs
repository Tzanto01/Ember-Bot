using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;

namespace Ember.Tests;

public class MissedDayReflectionTests
{
    [Fact]
    public void IsActiveOn_HabitCreatedToday_IsFalseForYesterday()
    {
        var habit = HabitFactory.Make(
            createdAtDaysAgo: 0,
            pausedUntilDaysAgo: null,
            frequency: FrequencyType.Daily,
            weeklyTarget: null);

        var yesterday = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);

        HabitService.IsActiveOn(habit, yesterday).Should().BeFalse();
    }

    [Fact]
    public void IsActiveOn_HabitCreatedYesterday_IsTrueForYesterday()
    {
        var habit = HabitFactory.Make(
            createdAtDaysAgo: 1,
            pausedUntilDaysAgo: null,
            frequency: FrequencyType.Daily,
            weeklyTarget: null);

        var yesterday = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);

        HabitService.IsActiveOn(habit, yesterday).Should().BeTrue();
    }

    [Fact]
    public void IsActiveOn_WeeklyHabitCreatedAfterWeekStart_IsFalseForEarlierDays()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var createdAt = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1));
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
