namespace Ember.Core.Services;

/// <summary>What one local day means for a habit, by the streak rules of <see cref="HabitService.ConsecutiveStreak"/>.</summary>
public enum DayState
{
    /// <summary>Before the habit's local start day; nothing can be logged.</summary>
    BeforeStart,

    /// <summary>Logged as done.</summary>
    Done,

    /// <summary>A closed day that isn't done (logged as not done, or not logged at all).</summary>
    NotDone,

    /// <summary>An open day (today or yesterday, see <see cref="HabitService.OpenDays"/>) that isn't done yet; never counts as missed.</summary>
    Pending,

    /// <summary>One of the user's low days: protected, neither breaks nor extends a streak.</summary>
    LowDay,

    /// <summary>Inside the habit's paused range: protected, neither breaks nor extends a streak.</summary>
    Paused,

    /// <summary>Not a scheduled day (see <see cref="HabitService.IsScheduledOn"/>) and not done: rest, never missed; streaks step over it.</summary>
    Offday,

    /// <summary>Some check-ins but fewer than the habit's <see cref="Models.Habit.TimesPerDay"/>; counts as not done for streaks.</summary>
    Partial,
}

/// <summary>
/// One local day of a habit: its <see cref="DayState"/>, whether it is done (true), explicitly not done (false, a log with
/// <c>Count</c> 0) or neither (null: no log, or partial), and the day's check-in <c>Count</c> (0 without a log).
/// </summary>
public sealed record HabitDay(DateOnly Date, DayState State, bool? Completed, int Count);
