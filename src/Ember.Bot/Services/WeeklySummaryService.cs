using Ember.Bot.Models;

namespace Ember.Bot.Services;

/// <summary>
/// Pure aggregation for the weekly summary DM: what each habit looked like over the
/// 7-day window ending on <c>weekEnd</c> (the last complete day), plus the
/// tone-appropriate headline/footer for how the user's week went.
/// No EF or Discord dependencies — fully unit-testable.
/// </summary>
public static class WeeklySummaryService
{
    /// <summary>Length of the summary window in days.</summary>
    public const int WindowDays = 7;

    public sealed record HabitSummary(
        Habit Habit,
        int Done,
        int Possible,
        int CurrentStreak,
        int GraceUsed,
        string DotString);

    public sealed record UserSummary(IReadOnlyList<HabitSummary> Habits, int TotalDone, int TotalPossible)
    {
        /// <summary>
        /// False when no habit had a single countable day in the window (every habit
        /// created today or paused throughout) — nothing meaningful to recap.
        /// </summary>
        public bool HasSummarableWeek => TotalPossible > 0;
    }

    public static UserSummary Build(User user, DateOnly weekEnd)
    {
        var from = weekEnd.AddDays(-(WindowDays - 1));

        var habits = user.Habits
            .OrderBy(h => h.CreatedAt)
            .Select(h => BuildHabit(h, user.GraceDaysPerWeek, from, weekEnd))
            .ToList();

        return new UserSummary(habits, habits.Sum(h => h.Done), habits.Sum(h => h.Possible));
    }

    private static HabitSummary BuildHabit(Habit habit, int graceDays, DateOnly from, DateOnly weekEnd)
    {
        var done = habit.Logs.Count(l => l.Completed && l.Date >= from && l.Date <= weekEnd);

        // Days in the window the habit could actually have been checked in:
        // strictly after its creation date and not paused.
        var activeDays = 0;
        for (var d = from; d <= weekEnd; d = d.AddDays(1))
        {
            if (HabitService.IsActiveOn(habit, d) && !HabitService.IsPausedOn(habit, d))
                activeDays++;
        }

        var possible = habit.FrequencyType == FrequencyType.Weekly
            ? Math.Min(habit.WeeklyTarget ?? 3, activeDays)
            : activeDays;

        // A check-in logged on a paused day still counts as done; never report
        // more done than possible.
        possible = Math.Max(possible, done);

        var (streak, graceUsed) = habit.FrequencyType == FrequencyType.Daily
            ? HabitService.ConsecutiveStreak(habit, graceDays)
            : (0, 0);

        return new HabitSummary(habit, done, possible, streak, graceUsed, BuildDotString(habit, from, weekEnd));
    }

    /// <summary>
    /// Picks the headline + footer matching how the week went: zero check-ins → gentle
    /// nudge, everything done → celebration, otherwise encouragement scaled to the rate.
    /// </summary>
    public static (string Headline, string Footer) ToneLines(int totalDone, int totalPossible)
    {
        if (totalDone == 0)
        {
            return (
                "It's been a quiet week — and that's okay. 💙\nWhenever you're ready, your habits are here waiting.",
                "No pressure. Progress happens at its own pace.");
        }

        // >= (not ==) also keeps degenerate inputs (possible < done) out of the
        // division below — this is a public helper, callers shouldn't be able to
        // hit a DivideByZeroException.
        if (totalDone >= totalPossible)
        {
            return (
                $"You nailed every single check-in this week 🔥 That's {totalDone}/{Math.Max(totalPossible, totalDone)}. Incredible.",
                "You're on fire. Keep going.");
        }

        var pct = (int)Math.Round(100.0 * totalDone / totalPossible);
        var headline = $"This week you completed **{totalDone}/{totalPossible}** check-ins ({pct}%). Every one of those counts. 💪";
        var footer = pct >= 50
            ? "More than half — that's a win. Keep it up."
            : "Small steps still move forward. You've got this.";
        return (headline, footer);
    }

    /// <summary>
    /// Builds a 7-character dot string like ✅⬜✅✅⬜✅✅ for the window, oldest→newest.
    /// </summary>
    public static string BuildDotString(Habit habit, DateOnly from, DateOnly to)
    {
        var completedDates = habit.Logs
            .Where(l => l.Completed && l.Date >= from && l.Date <= to)
            .Select(l => l.Date)
            .ToHashSet();

        var parts = new List<string>();
        for (var d = from; d <= to; d = d.AddDays(1))
            parts.Add(completedDates.Contains(d) ? "✅" : "⬜");

        return string.Concat(parts);
    }
}
