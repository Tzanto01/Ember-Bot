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

    /// <summary>When true, this user is excluded from server leaderboards.</summary>
    public bool LeaderboardOptOut { get; set; } = false;

    public ICollection<Habit> Habits { get; set; } = new List<Habit>();
}
