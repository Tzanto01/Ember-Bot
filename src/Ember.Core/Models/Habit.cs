namespace Ember.Core.Models;

public enum FrequencyType { Daily, Weekly, Weekdays }

/// <summary>Where a habit's reminders go. None means no reminders even when a reminder time is set.</summary>
[Flags]
public enum ReminderChannels
{
    None = 0,
    Discord = 1,
    WebPush = 2,

    /// <summary>Stored for the native app, which schedules local notifications on the device; the server never dispatches it.</summary>
    Mobile = 4,
}

public class Habit
{
    public int Id { get; set; }
    public Guid UserId { get; set; }
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

    /// <summary>Daily = check in every day. Weekly = check in WeeklyTarget times per week. Weekdays = check in on the <see cref="Days"/> only.</summary>
    public FrequencyType FrequencyType { get; set; } = FrequencyType.Daily;

    /// <summary>Target number of check-ins per week when FrequencyType = Weekly. Null for daily habits.</summary>
    public int? WeeklyTarget { get; set; }

    /// <summary>The weekdays a <see cref="FrequencyType.Weekdays"/> habit is scheduled on. Null for daily and weekly habits.</summary>
    public ScheduleDays? Days { get; set; }

    /// <summary>Check-ins needed for a day to be done (always 1 for weekly habits).</summary>
    public int TimesPerDay { get; set; } = 1;

    /// <summary>The routine this habit belongs to, if any.</summary>
    public int? RoutineId { get; set; }

    /// <summary>Order of this habit inside its routine.</summary>
    public int RoutinePosition { get; set; }

    /// <summary>Channels the reminder is sent to. Bot-created habits default to Discord; channels the user can't receive are skipped.</summary>
    public ReminderChannels ReminderChannels { get; set; } = ReminderChannels.Discord;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;
    public Routine? Routine { get; set; }
    public ICollection<HabitLog> Logs { get; set; } = new List<HabitLog>();
}
