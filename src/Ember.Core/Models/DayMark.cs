namespace Ember.Core.Models;

public enum DayMarkKind
{
    /// <summary>A day the user marked as low: it protects all their habits and counts as kept for "last 7 days".</summary>
    LowDay = 0,
}

/// <summary>A mark the user put on one of their local days, applying to all their habits.</summary>
public class DayMark
{
    public int Id { get; set; }
    public Guid UserId { get; set; }

    /// <summary>The user's local calendar date (in <see cref="User.Timezone"/>).</summary>
    public DateOnly Date { get; set; }

    public DayMarkKind Kind { get; set; }

    public User User { get; set; } = null!;
}
