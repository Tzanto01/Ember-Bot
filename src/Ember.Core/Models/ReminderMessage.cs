namespace Ember.Core.Models;

/// <summary>
/// A Discord reminder message whose buttons are still open. Kept only until the message is closed (or deleted on supersede),
/// then removed. Exactly one of <see cref="HabitId"/> and <see cref="RoutineId"/> is set. Not part of the export.
/// </summary>
public class ReminderMessage
{
    public int Id { get; set; }
    public Guid UserId { get; set; }

    /// <summary>The habit of a habit reminder; null for a routine reminder.</summary>
    public int? HabitId { get; set; }

    /// <summary>The routine of a routine reminder; null for a habit reminder.</summary>
    public int? RoutineId { get; set; }

    /// <summary>The user's local day the reminder was sent for.</summary>
    public DateOnly Date { get; set; }

    /// <summary>The Discord DM channel the message was sent in.</summary>
    public ulong ChannelId { get; set; }

    /// <summary>The Discord message id.</summary>
    public ulong MessageId { get; set; }
}
