namespace Ember.Core.Models;

/// <summary>
/// The journal entry for one of the user's local days. Stored either as plaintext (<see cref="Text"/>, <see cref="Mood"/>)
/// or, with the private journal on, as an opaque client-side ciphertext (<see cref="CipherVersion"/>, <see cref="CipherIv"/>, <see cref="CipherText"/>).
/// </summary>
public class DayNote
{
    public int Id { get; set; }
    public Guid UserId { get; set; }

    /// <summary>The user's local calendar date (in <see cref="User.Timezone"/>).</summary>
    public DateOnly Date { get; set; }

    /// <summary>Free text, up to 2000 characters. Null when unset or encrypted.</summary>
    public string? Text { get; set; }

    /// <summary>A built-in mood key or <c>custom:&lt;id&gt;</c> of one of the user's <see cref="Models.Mood"/>s. Null when unset or encrypted.</summary>
    public string? Mood { get; set; }

    /// <summary>Encryption format version; null for a plaintext entry.</summary>
    public int? CipherVersion { get; set; }

    /// <summary>AES-GCM IV (base64).</summary>
    public string? CipherIv { get; set; }

    /// <summary>AES-GCM ciphertext (base64).</summary>
    public string? CipherText { get; set; }

    public User User { get; set; } = null!;
}
