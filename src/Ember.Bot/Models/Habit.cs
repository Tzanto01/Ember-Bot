namespace Ember.Bot.Models;

public class Habit
{
    public int Id { get; set; }
    public long UserId { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>Time of day to send the DM reminder, in UTC. Null means no reminder.</summary>
    public TimeOnly? ReminderTime { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;
    public ICollection<HabitLog> Logs { get; set; } = new List<HabitLog>();
}
