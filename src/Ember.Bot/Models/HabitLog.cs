namespace Ember.Bot.Models;

public class HabitLog
{
    public int Id { get; set; }
    public int HabitId { get; set; }

    /// <summary>The calendar date (UTC) this log entry is for.</summary>
    public DateOnly Date { get; set; }

    public bool Completed { get; set; }

    public Habit Habit { get; set; } = null!;
}
