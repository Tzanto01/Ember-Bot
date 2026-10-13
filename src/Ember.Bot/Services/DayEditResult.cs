namespace Ember.Bot.Services;

/// <summary>Outcome of setting or clearing a day (a check-in or a low day).</summary>
public enum DayEditResult
{
    /// <summary>The change was stored.</summary>
    Saved,

    /// <summary>The habit doesn't exist or belongs to someone else.</summary>
    HabitNotFound,

    /// <summary>The day lies before the habit's local start day.</summary>
    BeforeHabitStart,

    /// <summary>The day lies after the user's local today.</summary>
    InFuture,
}
