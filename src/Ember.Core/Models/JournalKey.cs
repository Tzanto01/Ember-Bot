namespace Ember.Core.Models;

/// <summary>
/// The user's private-journal key, wrapped on the client by a passphrase-derived key and by a recovery-code-derived key.
/// The server never sees the unwrapped key. All binary fields are base64.
/// </summary>
public class JournalKey
{
    public Guid UserId { get; set; }

    /// <summary>Incremented on every change.</summary>
    public int Version { get; set; }

    public string PassphraseSalt { get; set; } = string.Empty;
    public int PassphraseIterations { get; set; }
    public string PassphraseIv { get; set; } = string.Empty;
    public string PassphraseWrapped { get; set; } = string.Empty;

    public string RecoverySalt { get; set; } = string.Empty;
    public string RecoveryIv { get; set; } = string.Empty;
    public string RecoveryWrapped { get; set; } = string.Empty;

    public User User { get; set; } = null!;
}
