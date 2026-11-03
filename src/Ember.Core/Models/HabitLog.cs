namespace Ember.Core.Models;

public class HabitLog
{
    public int Id { get; set; }
    public int HabitId { get; set; }

    /// <summary>
    /// The user's local calendar date (in <see cref="User.Timezone"/>) this log entry is for.
    /// Logs written before <see cref="Services.TimezoneHelper.SwitchoverDate"/> carry the UTC date.
    /// </summary>
    public DateOnly Date { get; set; }

    /// <summary>
    /// True when the day is done: <see cref="Count"/> reached the habit's <see cref="Habit.TimesPerDay"/> at the time of writing.
    /// A log with <see cref="Count"/> 0 and Completed false is an explicit "not done".
    /// </summary>
    public bool Completed { get; set; }

    /// <summary>Number of check-ins that day, 0 to the habit's <see cref="Habit.TimesPerDay"/>.</summary>
    public int Count { get; set; }

    /// <summary>Guild in which the check-in was performed. Null if done via DM.</summary>
    public long? GuildId { get; set; }

    public Habit Habit { get; set; } = null!;
}
