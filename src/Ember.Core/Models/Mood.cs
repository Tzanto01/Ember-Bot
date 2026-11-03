namespace Ember.Core.Models;

/// <summary>A mood the user defined for their journal, plaintext or encrypted like a <see cref="DayNote"/>.</summary>
public class Mood
{
    public int Id { get; set; }
    public Guid UserId { get; set; }

    /// <summary>Up to 24 characters. Null when encrypted.</summary>
    public string? Label { get; set; }

    /// <summary>One emoji grapheme, or null.</summary>
    public string? Emoji { get; set; }

    /// <summary>Hidden from the picker; past days keep showing it.</summary>
    public bool Archived { get; set; }

    /// <summary>Encryption format version; null for a plaintext mood.</summary>
    public int? CipherVersion { get; set; }

    /// <summary>AES-GCM IV (base64).</summary>
    public string? CipherIv { get; set; }

    /// <summary>AES-GCM ciphertext (base64).</summary>
    public string? CipherText { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;
}
