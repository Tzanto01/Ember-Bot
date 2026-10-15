namespace Ember.Core.Models;

public enum FrequencyType { Daily, Weekly }

public class Habit
{
    public int Id { get; set; }
    public long UserId { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>Time of day to send the DM reminder, stored in the user's local time. Null means no reminder.</summary>
    public TimeOnly? ReminderTime { get; set; }

    /// <summary>UTC instant of the next reminder (the next local ReminderTime, or a snooze). Null means nothing is due.</summary>
    public DateTime? NextReminderUtc { get; set; }

    /// <summary>
    /// Last local day of the pause. Days from <see cref="PausedFrom"/> through this day are paused: reminders are
    /// suppressed and the days are excluded from streak calculations.
    /// </summary>
    public DateOnly? PausedUntil { get; set; }

    /// <summary>First local day of the pause. Null with a <see cref="PausedUntil"/> means every day up to it is paused (pauses from before this field existed).</summary>
    public DateOnly? PausedFrom { get; set; }

    /// <summary>Daily = check in every day. Weekly = check in WeeklyTarget times per week.</summary>
    public FrequencyType FrequencyType { get; set; } = FrequencyType.Daily;

    /// <summary>Target number of check-ins per week when FrequencyType = Weekly. Null for daily habits.</summary>
    public int? WeeklyTarget { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;
    public ICollection<HabitLog> Logs { get; set; } = new List<HabitLog>();
}
