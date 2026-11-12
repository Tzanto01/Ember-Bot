namespace Ember.Core.Models;

/// <summary>
/// A habit or routine reminder delivered by web push for a local day, kept until the item is done for that day (then the bot sends
/// the clear push) or the reminder expires. Exactly one of <see cref="HabitId"/> and <see cref="RoutineId"/> is set; at most one row
/// per item and day. Not part of the export.
/// </summary>
public class PushReminder
{
    public int Id { get; set; }
    public Guid UserId { get; set; }
    public int? HabitId { get; set; }
    public int? RoutineId { get; set; }

    /// <summary>The user's local day the reminder was sent for.</summary>
    public DateOnly Date { get; set; }
}
