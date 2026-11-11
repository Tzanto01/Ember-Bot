namespace Ember.Core.Models;

/// <summary>
/// One web or app sign-in. The API carries <see cref="Id"/> in the cookie and bearer tokens and accepts them only while this
/// row exists and hasn't expired; deleting it signs that device out.
/// </summary>
public class AuthSession
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public DateTimeOffset CreatedUtc { get; set; }

    /// <summary>Slides forward while the session is in use.</summary>
    public DateTimeOffset ExpiresUtc { get; set; }

    public DateTimeOffset? LastSeenUtc { get; set; }
}
