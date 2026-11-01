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

    public User User { get; set; } = null!;
}
