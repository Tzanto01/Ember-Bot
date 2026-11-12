namespace Ember.Core.Models;

/// <summary>
/// One piece of in-app feedback from the web app, the Android app or Discord. Linked to the sender's account when they were
/// signed in (deleted with it, moved by an account merge), else anonymous. Mailed to the operator in the daily digest and
/// deleted 12 months after it was submitted. Not part of the export.
/// </summary>
public class Feedback
{
    public int Id { get; set; }

    public Guid? UserId { get; set; }

    /// <summary><c>web</c>, <c>android</c> or <c>discord</c>.</summary>
    public string Platform { get; set; } = string.Empty;

    /// <summary>The app version the client reported, if any.</summary>
    public string? Version { get; set; }

    public string Text { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; }

    /// <summary>When a digest email carried it; null while pending.</summary>
    public DateTime? DigestedAt { get; set; }
}
