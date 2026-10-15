using Ember.Core.Models;

namespace Ember.Tests;

internal static class HabitFactory
{
    /// <summary>
    /// Creates a daily habit with the given check-in log entries.
    /// daysAgo=0 means today, daysAgo=1 means yesterday, etc.
    /// </summary>
    /// <summary>Fixed anchor for daysAgo, so tests never depend on the real clock.</summary>
    public static readonly DateOnly Today = new(2025, 6, 18);

    public static Habit Make(params (int daysAgo, bool completed)[] entries)
        => Make(pausedUntilDaysAgo: null, FrequencyType.Daily, weeklyTarget: null, entries);

    /// <summary>
    /// Creates a habit with full control over frequency, pause state, and logs.
    /// pausedUntilDaysAgo: if set, PausedUntil = today - N days (positive = still paused, 0 = paused through today, negative = pause already ended).
    /// </summary>
    public static Habit Make(
        int? pausedUntilDaysAgo,
        FrequencyType frequency,
        int? weeklyTarget,
        params (int daysAgo, bool completed)[] entries)
        => Make(createdAtDaysAgo: 90, pausedUntilDaysAgo, frequency, weeklyTarget, entries);

    public static Habit Make(
        int createdAtDaysAgo,
        int? pausedUntilDaysAgo,
        FrequencyType frequency,
        int? weeklyTarget,
        params (int daysAgo, bool completed)[] entries)
    {
        var today = Today;
        var habit = new Habit
        {
            Id            = 1,
            Name          = "Test",
            FrequencyType = frequency,
            WeeklyTarget  = weeklyTarget,
            CreatedAt     = Today.ToDateTime(new TimeOnly(12, 0), DateTimeKind.Utc).AddDays(-createdAtDaysAgo),
        };

        if (pausedUntilDaysAgo.HasValue)
            habit.PausedUntil = today.AddDays(-pausedUntilDaysAgo.Value);

        foreach (var (daysAgo, completed) in entries)
            habit.Logs.Add(new HabitLog { Date = today.AddDays(-daysAgo), Completed = completed });

        return habit;
    }
}
