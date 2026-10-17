using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;

namespace Ember.Tests;

/// <summary>
/// Unit tests for the weekly-summary aggregation: the 7-day window ending yesterday
/// (the last complete day — today is still in progress when the job fires Sunday 09:00).
/// </summary>
public class WeeklySummaryServiceTests
{
    private static readonly DateOnly Today = HabitFactory.Today;

    // The job always summarises the window ending yesterday; tests use the same anchor.
    private static readonly DateOnly WeekEnd = Today.AddDays(-1);

    private static User UserWith(params Habit[] habits)
    {
        var user = new User { Id = TestUsers.Id(1), Logins = TestUsers.Discord(1) };
        foreach (var h in habits)
            user.Habits.Add(h);
        return user;
    }

    // ---- Check-in count: window boundaries ----

    [Fact]
    public void Done_CountsOnlyCompletedLogsInsideTheWindow()
    {
        // Window is [today-7 .. today-1]. Today (still in progress) and anything
        // 8+ days back are excluded; both window edges are included.
        var habit = HabitFactory.Make((0, true), (1, true), (7, true), (8, true));

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        summary.Habits.Single().Done.Should().Be(2); // daysAgo 1 and 7 only
        summary.TotalDone.Should().Be(2);
    }

    [Fact]
    public void Done_IgnoresIncompleteLogs()
    {
        var habit = HabitFactory.Make((1, false), (2, true), (3, false));

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        summary.Habits.Single().Done.Should().Be(1);
    }

    [Fact]
    public void Totals_SumAcrossAllHabits()
    {
        var h1 = HabitFactory.Make((1, true));
        var h2 = HabitFactory.Make((1, true), (2, true));

        var summary = WeeklySummaryService.Build(UserWith(h1, h2), WeekEnd);

        summary.TotalDone.Should().Be(3);
        summary.TotalPossible.Should().Be(14); // two long-established daily habits × 7 days
    }

    // ---- Possible days: creation date, pauses, weekly targets ----

    [Fact]
    public void Possible_IsSeven_ForAnEstablishedDailyHabit()
    {
        var habit = HabitFactory.Make((1, true));

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        summary.Habits.Single().Possible.Should().Be(7);
    }

    [Fact]
    public void Possible_ExcludesDaysBeforeAndIncludingCreation()
    {
        // Created 3 days ago; IsActiveOn is strictly-after-creation, so only
        // today-2 and today-1 are countable days inside the window.
        var habit = HabitFactory.Make(createdAtDaysAgo: 3, pausedUntilDaysAgo: null,
            FrequencyType.Daily, weeklyTarget: null, (1, true), (2, true));

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        var h = summary.Habits.Single();
        h.Possible.Should().Be(2);
        h.Done.Should().Be(2); // a perfect week for a 2-day-old habit is 2/2, not 2/7
    }

    [Fact]
    public void Possible_ExcludesPausedDays()
    {
        // PausedUntil = today-3 → every window day up to and including today-3 is
        // paused; only today-2 and today-1 count.
        var habit = HabitFactory.Make(pausedUntilDaysAgo: 3, FrequencyType.Daily, weeklyTarget: null);

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        summary.Habits.Single().Possible.Should().Be(2);
    }

    [Fact]
    public void Possible_ForWeeklyHabit_IsTheWeeklyTarget()
    {
        var habit = HabitFactory.Make(pausedUntilDaysAgo: null, FrequencyType.Weekly, weeklyTarget: 3,
            (1, true), (2, true));

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        var h = summary.Habits.Single();
        h.Possible.Should().Be(3); // target, not 7
        h.Done.Should().Be(2);
    }

    [Fact]
    public void Possible_ForWeeklyHabit_IsCappedByActiveDays()
    {
        // Weekly habit with target 3, but created 2 days ago → only 1 active day.
        var habit = HabitFactory.Make(createdAtDaysAgo: 2, pausedUntilDaysAgo: null,
            FrequencyType.Weekly, weeklyTarget: 3);

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        summary.Habits.Single().Possible.Should().Be(1);
    }

    [Fact]
    public void Possible_NeverReportsLessThanDone()
    {
        // Paused through tomorrow (all window days paused), but the user still checked
        // in once — done must not exceed possible in the DM (no "1/0").
        var habit = HabitFactory.Make(pausedUntilDaysAgo: -1, FrequencyType.Daily, weeklyTarget: null,
            (1, true));

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        var h = summary.Habits.Single();
        h.Done.Should().Be(1);
        h.Possible.Should().Be(1);
    }

    // ---- Current streak ----

    [Fact]
    public void CurrentStreak_ReflectsConsecutiveCompletedDays()
    {
        var habit = HabitFactory.Make((1, true), (2, true), (3, true));

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        var h = summary.Habits.Single();
        h.CurrentStreak.Should().Be(3);
        h.GraceUsed.Should().Be(0);
    }

    [Fact]
    public void CurrentStreak_UsesTheUsersGraceDays()
    {
        // Gap at today-2 is bridged by the user's grace allowance.
        var user = UserWith(HabitFactory.Make((1, true), (3, true)));
        user.GraceDaysPerWeek = 2;

        var summary = WeeklySummaryService.Build(user, WeekEnd);

        var h = summary.Habits.Single();
        h.CurrentStreak.Should().Be(2);
        h.GraceUsed.Should().Be(1);
    }

    [Fact]
    public void CurrentStreak_IsZeroForWeeklyHabits()
    {
        // Weekly habits have no consecutive-day streak; they track a weekly target.
        var habit = HabitFactory.Make(pausedUntilDaysAgo: null, FrequencyType.Weekly, weeklyTarget: 3,
            (1, true), (2, true), (3, true));

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        summary.Habits.Single().CurrentStreak.Should().Be(0);
    }

    // ---- Nothing-to-summarise guard ----

    [Fact]
    public void HasSummarableWeek_IsFalse_WhenHabitWasCreatedToday()
    {
        var habit = HabitFactory.Make(createdAtDaysAgo: 0, pausedUntilDaysAgo: null,
            FrequencyType.Daily, weeklyTarget: null);

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        summary.HasSummarableWeek.Should().BeFalse();
    }

    [Fact]
    public void HasSummarableWeek_IsFalse_WhenAllHabitsPausedThroughTheWindow()
    {
        var habit = HabitFactory.Make(pausedUntilDaysAgo: -1, FrequencyType.Daily, weeklyTarget: null);

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        summary.HasSummarableWeek.Should().BeFalse();
    }

    [Fact]
    public void HasSummarableWeek_IsTrue_ForAnActiveHabitWithNoCheckIns()
    {
        // Zero activity but an active habit → still summarable (the gentle nudge).
        var habit = HabitFactory.Make();

        var summary = WeeklySummaryService.Build(UserWith(habit), WeekEnd);

        summary.HasSummarableWeek.Should().BeTrue();
        summary.TotalDone.Should().Be(0);
    }

    // ---- Tone lines ----

    [Fact]
    public void ToneLines_ZeroDone_IsTheGentleNudge()
    {
        var (headline, footer) = WeeklySummaryService.ToneLines(0, 7);

        headline.Should().Contain("quiet week");
        footer.Should().Be("No pressure. Progress happens at its own pace.");
    }

    [Fact]
    public void ToneLines_EverythingDone_Celebrates()
    {
        var (headline, footer) = WeeklySummaryService.ToneLines(7, 7);

        headline.Should().Contain("nailed every single check-in");
        headline.Should().Contain("7/7");
        footer.Should().Be("You're on fire. Keep going.");
    }

    [Fact]
    public void ToneLines_HalfOrMore_EncouragesTheWin()
    {
        var (headline, footer) = WeeklySummaryService.ToneLines(4, 7); // 57%

        headline.Should().Contain("**4/7**");
        headline.Should().Contain("(57%)");
        footer.Should().Be("More than half — that's a win. Keep it up.");
    }

    [Fact]
    public void ToneLines_DegenerateInput_DoesNotDivideByZero()
    {
        // ToneLines is a public helper; Build() always supplies possible >= done,
        // but a direct caller must not be able to trigger a DivideByZeroException.
        var act = () => WeeklySummaryService.ToneLines(5, 0);

        act.Should().NotThrow();
        act().Footer.Should().Be("You're on fire. Keep going.");
    }

    [Fact]
    public void ToneLines_UnderHalf_StaysGentle()
    {
        var (headline, footer) = WeeklySummaryService.ToneLines(2, 7); // 29%

        headline.Should().Contain("**2/7**");
        headline.Should().Contain("(29%)");
        footer.Should().Be("Small steps still move forward. You've got this.");
    }

    // ---- Dot string ----

    [Fact]
    public void DotString_RendersWindowOldestToNewest()
    {
        var habit = HabitFactory.Make((1, true), (3, true));
        var from = WeekEnd.AddDays(-6);

        var dots = WeeklySummaryService.BuildDotString(habit, from, WeekEnd);

        dots.Should().Be("⬜⬜⬜⬜✅⬜✅"); // today-3 at index 4, today-1 (newest) last
    }
}
