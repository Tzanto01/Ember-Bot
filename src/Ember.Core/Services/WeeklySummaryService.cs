using Ember.Core.Localization;
using Ember.Core.Models;

namespace Ember.Core.Services;

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
        var tz = TimezoneHelper.Find(user.Timezone) ?? TimeZoneInfo.Utc;
        var lowDays = user.DayMarks.Where(m => m.Kind == DayMarkKind.LowDay).Select(m => m.Date).ToHashSet();

        var habits = user.Habits
            .OrderBy(h => h.CreatedAt)
            .Select(h => BuildHabit(h, user.GraceDaysPerWeek, from, weekEnd, tz, lowDays))
            .ToList();

        return new UserSummary(habits, habits.Sum(h => h.Done), habits.Sum(h => h.Possible));
    }

    private static HabitSummary BuildHabit(Habit habit, int graceDays, DateOnly from, DateOnly weekEnd, TimeZoneInfo tz,
        HashSet<DateOnly> lowDays)
    {
        var done = habit.Logs.Count(l => l.Completed && l.Date >= from && l.Date <= weekEnd);

        // Days in the window the habit could actually have been checked in:
        // strictly after its creation date, scheduled, not paused and not a low day.
        var activeDays = 0;
        for (var d = from; d <= weekEnd; d = d.AddDays(1))
        {
            if (HabitService.IsActiveOn(habit, d, tz) && HabitService.IsScheduledOn(habit, d)
                && !HabitService.IsPausedOn(habit, d) && !lowDays.Contains(d))
                activeDays++;
        }

        var possible = habit.FrequencyType == FrequencyType.Weekly
            ? Math.Min(habit.WeeklyTarget ?? 3, activeDays)
            : activeDays;

        // A check-in logged on a paused day still counts as done; never report
        // more done than possible.
        possible = Math.Max(possible, done);

        var (streak, graceUsed) = habit.FrequencyType != FrequencyType.Weekly
            ? HabitService.ConsecutiveStreak(habit, weekEnd.AddDays(1), graceDays, lowDays)
            : (0, 0);

        return new HabitSummary(habit, done, possible, streak, graceUsed, BuildDotString(habit, from, weekEnd));
    }

    /// <summary>
    /// Picks the headline + footer matching how the week went: zero check-ins → gentle
    /// nudge, everything done → celebration, otherwise encouragement scaled to the rate. In <paramref name="t"/>, English when null.
    /// </summary>
    public static (string Headline, string Footer) ToneLines(int totalDone, int totalPossible, Texts? t = null)
    {
        t ??= new Texts(Languages.English, Texts.CoreResources);
        if (totalDone == 0)
            return (t.Get("weekly.tone.quiet.headline"), t.Get("weekly.tone.quiet.footer"));

        // >= (not ==) also keeps degenerate inputs (possible < done) out of the
        // division below — this is a public helper, callers shouldn't be able to
        // hit a DivideByZeroException.
        var checkIns = t.Plural("weekly.checkins", totalDone);
        if (totalDone >= totalPossible)
            return (t.Format("weekly.tone.all.headline", checkIns), t.Get("weekly.tone.all.footer"));

        var pct = (int)Math.Round(100.0 * totalDone / totalPossible);
        return (t.Format("weekly.tone.some.headline", checkIns), t.Get(pct >= 50 ? "weekly.tone.half.footer" : "weekly.tone.small.footer"));
    }

    /// <summary>
    /// Builds a 7-dot string like ✅⬜✅🔸▫️✅✅ for the window, oldest→newest: ✅ done, 🔸 partial,
    /// ▫️ offday (not scheduled, not done), ⬜ otherwise.
    /// </summary>
    public static string BuildDotString(Habit habit, DateOnly from, DateOnly to)
    {
        var parts = new List<string>();
        for (var d = from; d <= to; d = d.AddDays(1))
        {
            var log = habit.Logs.FirstOrDefault(l => l.Date == d);
            parts.Add(log?.Completed == true ? "✅"
                : log is { Count: > 0 } ? "🔸"
                : !HabitService.IsScheduledOn(habit, d) ? "▫️"
                : "⬜");
        }

        return string.Concat(parts);
    }
}
