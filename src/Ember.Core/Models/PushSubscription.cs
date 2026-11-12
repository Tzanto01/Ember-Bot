namespace Ember.Core.Models;

/// <summary>A browser's Web Push subscription. An endpoint belongs to at most one user.</summary>
public class PushSubscription
{
    public int Id { get; set; }
    public Guid UserId { get; set; }

    /// <summary>The push service URL the browser handed out.</summary>
    public string Endpoint { get; set; } = string.Empty;

    /// <summary>The client's P-256 public key (base64url).</summary>
    public string P256dh { get; set; } = string.Empty;

    /// <summary>The client's authentication secret (base64url).</summary>
    public string Auth { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Readable browser name ("Firefox on Linux") derived from the User-Agent of the request that last saved it; null before v1.14.</summary>
    public string? Label { get; set; }

    /// <summary>Whether reminders go to this browser; off in Settings mutes it for every habit and routine.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// The sign-in session (<see cref="AuthSession"/>) that last registered it; ending that session deletes the subscription.
    /// Null for subscriptions saved before sessions were recorded. Reminders carry a "Done" token only while it is live.
    /// </summary>
    public Guid? SessionId { get; set; }

    public User User { get; set; } = null!;
}
