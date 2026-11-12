namespace Ember.Core.Models;

/// <summary>A phone running the Ember app, registered by its install id. An install id belongs to at most one user.</summary>
public class ReminderPhone
{
    public int Id { get; set; }
    public Guid UserId { get; set; }

    /// <summary>The app's random, stable install id.</summary>
    public string InstallId { get; set; } = string.Empty;

    /// <summary>Readable phone name sent by the app ("Pixel 8"), or "Android phone".</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>Whether reminders go to this phone; off in Settings mutes it for every habit and routine.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>The sign-in session (<see cref="AuthSession"/>) that last registered it; ending that session deletes the phone.</summary>
    public Guid? SessionId { get; set; }

    /// <summary>When it was last registered.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;
}
