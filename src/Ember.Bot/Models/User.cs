namespace Ember.Bot.Models;

public class User
{
    public long DiscordUserId { get; set; }
    public string Timezone { get; set; } = "UTC";

    /// <summary>
    /// Number of missed days per week that are forgiven before breaking a streak.
    /// Default 1. Users can adjust with /streak grace.
    /// </summary>
    public int GraceDaysPerWeek { get; set; } = 1;

    /// <summary>
    /// When true, this user appears on leaderboards. Off by default: only an explicit
    /// opt-in (via /privacy optin or the leaderboard button) turns it on.
    /// </summary>
    public bool LeaderboardOptIn { get; set; }

    /// <summary>Consecutive reminder DMs that Discord refused to deliver. Reset by any delivered reminder.</summary>
    public int DmFailureCount { get; set; }

    /// <summary>Set when DM reminders stopped after repeated undeliverable DMs; null while they are active.</summary>
    public DateTime? DmRemindersPausedAt { get; set; }

    /// <summary>When the user was told their DM reminders are paused, so the notice is shown only once.</summary>
    public DateTime? DmPauseNoticeSentAt { get; set; }

    public ICollection<Habit> Habits { get; set; } = new List<Habit>();
}
