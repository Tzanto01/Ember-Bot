namespace Ember.Bot.Models;

public class User
{
    public long DiscordUserId { get; set; }
    public string Timezone { get; set; } = "UTC";

    public ICollection<Habit> Habits { get; set; } = new List<Habit>();
}
