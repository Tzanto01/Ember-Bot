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

    public ICollection<Habit> Habits { get; set; } = new List<Habit>();
}
