namespace Ember.Core.Models;

/// <summary>
/// One picture attached to a <see cref="Models.Feedback"/>, stored with its metadata already stripped. Deleted with the feedback
/// and 30 days after the feedback was resolved. Not part of the export.
/// </summary>
public class FeedbackImage
{
    /// <summary>Opaque version 7 GUID, so ids sort in upload order; the id the digest lists and <c>--feedback-images</c> takes.</summary>
    public Guid Id { get; set; }

    public int FeedbackId { get; set; }

    /// <summary><c>image/jpeg</c>, <c>image/png</c> or <c>image/webp</c>, as sniffed from the bytes.</summary>
    public string ContentType { get; set; } = string.Empty;

    /// <summary>Length of <see cref="Data"/> in bytes, for the byte budgets and the digest without loading the data.</summary>
    public int Size { get; set; }

    public byte[] Data { get; set; } = [];
}
