namespace Ember.Core.Models;

/// <summary>
/// The user's "What helps me" list, encrypted on the client with the private-journal key (the day-note envelope). One row per
/// account; the server never sees the plaintext.
/// </summary>
public class UserHelps
{
    public Guid UserId { get; set; }

    /// <summary>The ciphertext envelope, at most <see cref="MaxEncryptedLength"/> characters.</summary>
    public string Encrypted { get; set; } = string.Empty;

    /// <summary>Starts at 1 and is incremented on every save, for optimistic concurrency.</summary>
    public int Version { get; set; }

    public DateTime UpdatedAt { get; set; }

    public User User { get; set; } = null!;

    /// <summary>Most characters <see cref="Encrypted"/> may hold (16 KiB).</summary>
    public const int MaxEncryptedLength = 16 * 1024;
}
