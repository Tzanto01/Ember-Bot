namespace Ember.Bot.Models;

public enum FrequencyType { Daily, Weekly }

public class Habit
{
    public int Id { get; set; }
    public long UserId { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>Time of day to send the DM reminder, stored in the user's local time. Null means no reminder.</summary>
    public TimeOnly? ReminderTime { get; set; }

    /// <summary>When set, reminders are suppressed and paused days are excluded from streak calculations.</summary>
    public DateOnly? PausedUntil { get; set; }

    /// <summary>Daily = check in every day. Weekly = check in WeeklyTarget times per week.</summary>
    public FrequencyType FrequencyType { get; set; } = FrequencyType.Daily;

    /// <summary>Target number of check-ins per week when FrequencyType = Weekly. Null for daily habits.</summary>
    public int? WeeklyTarget { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;
    public ICollection<HabitLog> Logs { get; set; } = new List<HabitLog>();
}
