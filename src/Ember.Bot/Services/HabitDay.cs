namespace Ember.Bot.Services;

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
}

/// <summary>One local day of a habit: its <see cref="DayState"/> and the raw log (<c>Completed</c> is null when the day has no log).</summary>
public sealed record HabitDay(DateOnly Date, DayState State, bool? Completed);
