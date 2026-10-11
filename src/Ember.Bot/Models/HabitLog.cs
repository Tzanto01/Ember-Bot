namespace Ember.Bot.Models;

public class HabitLog
{
    public int Id { get; set; }
    public int HabitId { get; set; }

    /// <summary>
    /// The user's local calendar date (in <see cref="User.Timezone"/>) this log entry is for.
    /// Logs written before <see cref="Services.TimezoneHelper.SwitchoverDate"/> carry the UTC date.
    /// </summary>
    public DateOnly Date { get; set; }

    public bool Completed { get; set; }

    /// <summary>Guild in which the check-in was performed. Null if done via DM.</summary>
    public long? GuildId { get; set; }

    public Habit Habit { get; set; } = null!;
}
