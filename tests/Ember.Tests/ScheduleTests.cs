using Ember.Bot.Jobs;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;

namespace Ember.Tests;

/// <summary>Weekdays schedules (offdays) and times per day (partial days) in the pure Core rules. HabitFactory.Today is a Wednesday.</summary>
public class ScheduleTests
{
    private static readonly DateOnly Today = HabitFactory.Today;
    private static readonly HashSet<DateOnly> NoLowDays = [];
    private const ScheduleDays MonWedFri = ScheduleDays.Mon | ScheduleDays.Wed | ScheduleDays.Fri;

    private static Habit Weekdays(ScheduleDays days, params (int daysAgo, bool completed)[] entries)
    {
        var habit = HabitFactory.Make(entries);
        habit.FrequencyType = FrequencyType.Weekdays;
        habit.Days = days;
        return habit;
    }

    private static void AddLog(Habit habit, int daysAgo, int count)
        => habit.Logs.Add(new HabitLog { Date = Today.AddDays(-daysAgo), Count = count, Completed = count >= habit.TimesPerDay });

    [Fact]
    public void DayOn_ShowsOffdaysAsRest_PartialDaysWithTheirCount_AndADoneOffdayAsDone()
    {
        var habit = Weekdays(MonWedFri);
        habit.TimesPerDay = 2;
        AddLog(habit, 2, 1);
        AddLog(habit, 3, 2);

        var days = Enumerable.Range(0, 6).Select(ago => HabitService.DayOn(habit, Today.AddDays(-ago), Today, TimeZoneInfo.Utc, NoLowDays));

        days.Select(d => (d.State, d.Completed, d.Count)).Should().Equal(
            (DayState.Pending, null, 0),
            (DayState.Offday, null, 0),
            (DayState.Partial, null, 1),
            (DayState.Done, true, 2),
            (DayState.Offday, null, 0),
            (DayState.NotDone, null, 0));
    }

    [Fact]
    public void Streak_StepsOverOffdays_AndADoneOffdayExtendsIt()
    {
        var habit = Weekdays(MonWedFri, (2, true), (4, true), (5, true), (7, true));

        HabitService.ConsecutiveStreak(habit, Today, graceDays: 0).Should().Be((4, 0));
        HabitService.BestStreak(habit, Today, graceDays: 0).Should().Be(4);
    }

    [Fact]
    public void Streak_ClosedPartialDay_IsAGapThatOnlyGraceForgives()
    {
        var habit = HabitFactory.Make((2, true), (4, true));
        habit.TimesPerDay = 2;
        AddLog(habit, 3, 1);

        HabitService.ConsecutiveStreak(habit, Today, graceDays: 1).Should().Be((2, 1));
        HabitService.ConsecutiveStreak(habit, Today, graceDays: 0).Should().Be((1, 0));
    }

    [Fact]
    public void FlexibleStreak_CountsDoneOffdays_ButNotLowDaysOnOffdays()
    {
        var habit = Weekdays(MonWedFri, (3, true));
        var lowDays = new HashSet<DateOnly> { Today.AddDays(-1), Today.AddDays(-2) };

        HabitService.FlexibleStreak(habit, Today, 7, lowDays, TimeZoneInfo.Utc).Should().Be(2);
    }

    [Fact]
    public void WeeklySummary_PossibleCountsOnlyScheduledDays_AndDotsShowPartialAndRest()
    {
        var habit = Weekdays(MonWedFri, (1, false), (4, true));
        habit.TimesPerDay = 2;
        AddLog(habit, 2, 1);
        var user = new User { Id = TestUsers.Id(1), Logins = TestUsers.Discord(1) };
        user.Habits.Add(habit);

        var summary = WeeklySummaryService.Build(user, Today.AddDays(-1)).Habits.Single();

        summary.Possible.Should().Be(3);
        summary.Done.Should().Be(1);
        summary.DotString.Should().Be("⬜▫️⬜✅▫️🔸▫️");
    }

    [Fact]
    public void DayStatsOn_CountsScheduledDonePartialAndShowedUp()
    {
        var restDay = Today.AddDays(-1);
        var weekdays = Weekdays(MonWedFri);
        weekdays.TimesPerDay = 2;
        AddLog(weekdays, 1, 2);
        var partial = HabitFactory.Make();
        partial.TimesPerDay = 3;
        AddLog(partial, 1, 1);
        var paused = HabitFactory.Make(pausedUntilDaysAgo: 0, FrequencyType.Daily, null);
        var notStarted = HabitFactory.Make(createdAtDaysAgo: 0, null, FrequencyType.Weekly, 3);
        var habits = new[] { weekdays, partial, paused, notStarted };

        HabitService.DayStatsOn(habits, restDay, TimeZoneInfo.Utc).Should().Be(new DayStats(restDay, 1, 1, 1, true));
        HabitService.DayStatsOn(habits, Today.AddDays(-2), TimeZoneInfo.Utc).Should().Be(new DayStats(Today.AddDays(-2), 2, 0, 0, false));
    }

    [Fact]
    public void Reflection_IsNeverOfferedForAnOffday_ButAPartialDayIsStillOpen()
    {
        var habit = Weekdays(MonWedFri);
        habit.TimesPerDay = 2;
        AddLog(habit, 2, 1);

        MissedDayReflectionJob.IsOpenDaily(habit, Today.AddDays(-1), TimeZoneInfo.Utc).Should().BeFalse();
        MissedDayReflectionJob.IsOpenDaily(habit, Today.AddDays(-2), TimeZoneInfo.Utc).Should().BeTrue();
    }
}
