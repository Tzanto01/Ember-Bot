using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;

namespace Ember.Tests;

public class WeeklyProgressTests
{
    // WeeklyProgress counts check-ins from Monday through Sunday of the current week.
    // HabitFactory daysAgo=0 is today; the week boundaries depend on today's actual date,
    // so we must be careful to only use daysAgo values within the current Mon–Sun window.

    private static int DaysFromMonday()
    {
        var dow = (int)DateTime.UtcNow.DayOfWeek; // 0=Sun
        return dow == 0 ? 6 : dow - 1;            // days since Monday
    }

    [Fact]
    public void NoLogs_ReturnsZeroDone()
    {
        var habit = HabitFactory.Make(
            null, FrequencyType.Weekly, weeklyTarget: 3);
        var (done, target) = HabitService.WeeklyProgress(habit);
        done.Should().Be(0);
        target.Should().Be(3);
    }

    [Fact]
    public void LogsThisWeek_CountedCorrectly()
    {
        var daysFromMonday = DaysFromMonday();
        // Check in on every day from Monday through today
        var entries = Enumerable.Range(0, daysFromMonday + 1)
            .Select(i => (i, true))
            .ToArray();

        var habit = HabitFactory.Make(
            null, FrequencyType.Weekly, weeklyTarget: 5, entries);

        var (done, target) = HabitService.WeeklyProgress(habit);
        done.Should().Be(daysFromMonday + 1);
        target.Should().Be(5);
    }

    [Fact]
    public void LogsFromPreviousWeek_NotCounted()
    {
        var daysFromMonday = DaysFromMonday();
        // Add a log from last week (Monday - 1 = last Sunday)
        var lastSundayAgo = daysFromMonday + 1;

        var habit = HabitFactory.Make(
            null, FrequencyType.Weekly, weeklyTarget: 3,
            (lastSundayAgo, true)); // last week

        var (done, _) = HabitService.WeeklyProgress(habit);
        done.Should().Be(0);
    }

    [Fact]
    public void SkippedLogsThisWeek_NotCounted()
    {
        var daysFromMonday = DaysFromMonday();
        if (daysFromMonday < 1)
        {
            // It's Monday — we can't have a skipped day earlier this week; skip this test
            return;
        }

        var habit = HabitFactory.Make(
            null, FrequencyType.Weekly, weeklyTarget: 3,
            (0, true),           // today: done
            (1, false));         // yesterday: skipped

        var (done, _) = HabitService.WeeklyProgress(habit);
        done.Should().Be(1);
    }

    [Fact]
    public void DefaultTarget_IsThree_WhenWeeklyTargetNull()
    {
        var habit = HabitFactory.Make(
            null, FrequencyType.Weekly, weeklyTarget: null);
        var (_, target) = HabitService.WeeklyProgress(habit);
        target.Should().Be(3);
    }

    [Fact]
    public void ReachedTarget_DoneEqualsTarget()
    {
        var daysFromMonday = DaysFromMonday();
        if (daysFromMonday < 2)
            return; // Not enough days this week to check in 3 times

        var habit = HabitFactory.Make(
            null, FrequencyType.Weekly, weeklyTarget: 3,
            (0, true), (1, true), (2, true));

        var (done, target) = HabitService.WeeklyProgress(habit);
        done.Should().Be(3);
        target.Should().Be(3);
    }
}
