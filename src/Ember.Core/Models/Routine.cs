namespace Ember.Core.Models;

/// <summary>A named, ordered group of habits with an optional shared reminder.</summary>
public class Routine
{
    public int Id { get; set; }
    public Guid UserId { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>Time of day of the routine's reminder, in the user's local time. Null means no reminder.</summary>
    public TimeOnly? ReminderTime { get; set; }

    /// <summary>UTC instant of the next routine reminder. Null means nothing is due.</summary>
    public DateTime? NextReminderUtc { get; set; }

    /// <summary>Channels the routine's reminder is sent to.</summary>
    public ReminderChannels ReminderChannels { get; set; } = ReminderChannels.WebPush;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;

    /// <summary>Member habits, ordered by <see cref="Habit.RoutinePosition"/>.</summary>
    public ICollection<Habit> Habits { get; set; } = new List<Habit>();
}
