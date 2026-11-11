namespace Ember.Core.Models;

/// <summary>
/// The one-time secret behind the "Done" action of a single-habit web push reminder. Only the SHA-256 hash of the token is
/// stored; the token itself travels in the push payload. Bound to one user, habit and local day, usable once until
/// <see cref="ExpiresUtc"/>. Deleted with the user or habit and purged daily once expired. Not part of the export.
/// </summary>
public class ReminderActionToken
{
    public int Id { get; set; }

    /// <summary>SHA-256 of the token's UTF-8 bytes.</summary>
    public byte[] TokenHash { get; set; } = [];

    public Guid UserId { get; set; }

    public int HabitId { get; set; }

    /// <summary>The user's local day the reminder was sent for; the check-in goes to this day.</summary>
    public DateOnly Day { get; set; }

    /// <summary>When the reminder closes, as its Discord buttons would.</summary>
    public DateTime ExpiresUtc { get; set; }

    /// <summary>When the token was used; set at most once.</summary>
    public DateTime? UsedUtc { get; set; }
}
