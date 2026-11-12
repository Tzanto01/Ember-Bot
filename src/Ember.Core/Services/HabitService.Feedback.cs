using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>In-app feedback, sent from the API (web, Android) and the bot (Discord).</summary>
public partial class HabitService
{
    /// <summary>Most characters (UTF-16 code units) a feedback text can have after trimming.</summary>
    public const int MaxFeedbackLength = 2000;

    /// <summary>Most characters (UTF-16 code units) a feedback title can have after trimming.</summary>
    public const int MaxFeedbackTitleLength = 100;

    /// <summary>Most feedback stored in any 24 hours, across every platform; also the most one digest email carries.</summary>
    public const int MaxFeedbackPerDay = 300;

    /// <summary>Most picture bytes one sender (account or Discord user) can send in any 24 hours, enforced by the caller in memory.</summary>
    public const long MaxFeedbackImageBytesPerUserPerDay = 30L * 1024 * 1024;

    /// <summary>Most stored picture bytes (<see cref="FeedbackImage.Size"/>) all feedback can carry in any 24 hours.</summary>
    public const long MaxFeedbackImageBytesPerDay = 100L * 1024 * 1024;

    /// <summary>
    /// Why a feedback text can't be stored, or null when it can. <paramref name="text"/> must already be trimmed. Rejects an
    /// empty text, one over <see cref="MaxFeedbackLength"/>, control characters other than tab, line feed and carriage return,
    /// bidi controls (U+202A to U+202E, U+2066 to U+2069) and unpaired UTF-16 surrogates.
    /// </summary>
    public static string? FeedbackTextError(string text)
    {
        if (text.Length == 0) return "Required.";
        if (text.Length > MaxFeedbackLength) return $"At most {MaxFeedbackLength} characters.";

        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if ((char.IsControl(c) && c is not ('\n' or '\r' or '\t')) || c is (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u2069')) return "Contains characters that aren't allowed.";
            if (char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) i++;
            else if (char.IsSurrogate(c)) return "Contains characters that aren't allowed.";
        }

        return null;
    }

    /// <summary>
    /// Why a feedback title can't be stored, or null when it can. <paramref name="title"/> must already be trimmed. The rules of
    /// <see cref="FeedbackTextError"/>, at most <see cref="MaxFeedbackTitleLength"/> and on one line (no line break, tab, U+2028 or U+2029).
    /// </summary>
    public static string? FeedbackTitleError(string title)
    {
        if (title.Length > MaxFeedbackTitleLength) return $"At most {MaxFeedbackTitleLength} characters.";
        if (title.AsSpan().IndexOfAny("\n\r\t\u2028\u2029") >= 0) return "Keep the title on one line.";
        return FeedbackTextError(title);
    }

    /// <summary>
    /// Stores one feedback, submitted now, and returns true; returns false and stores nothing when <see cref="MaxFeedbackPerDay"/>
    /// were already submitted in the last 24 hours, or when <paramref name="images"/> would take the pictures stored in the last 24
    /// hours over <see cref="MaxFeedbackImageBytesPerDay"/> (checked before the insert, not atomically, so parallel requests can
    /// overshoot it by what they carry). The per-sender byte budget (<see cref="MaxFeedbackImageBytesPerUserPerDay"/>) is the
    /// caller's. <paramref name="userId"/> is kept only while that user exists; when the user is deleted or merged away in the
    /// meantime the feedback is stored without one and without its pictures, so they never outlive the account. The caller validates the input (<see cref="FeedbackTextError"/>,
    /// <see cref="FeedbackTitleError"/>, trimmed, pictures from <see cref="FeedbackImages.Sanitize"/>).
    /// </summary>
    /// <param name="userId">The sender's account, or null when they have none or send anonymously.</param>
    /// <param name="platform"><c>web</c>, <c>android</c> or <c>discord</c>.</param>
    /// <param name="title">The title; null takes the first line of <paramref name="text"/>, tabs as spaces, cut to <see cref="MaxFeedbackTitleLength"/>.</param>
    /// <param name="images">
    /// Pictures stored with the feedback in the same save; <see cref="FeedbackImage.Size"/> is set from the data and
    /// <see cref="FeedbackImage.Id"/> to version 7 GUIDs that sort in this order.
    /// </param>
    public async Task<bool> SaveFeedbackAsync(Guid? userId, string platform, string? version, string text, CancellationToken cancellationToken = default,
        string? title = null, IReadOnlyList<FeedbackImage>? images = null)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        var since = now.AddHours(-24);
        if (await _db.Feedback.CountAsync(f => f.CreatedAt > since, cancellationToken) >= MaxFeedbackPerDay) return false;

        if (images is { Count: > 0 })
        {
            for (var i = 0; i < images.Count; i++)
            {
                images[i].Id = Guid.CreateVersion7(_time.GetUtcNow().AddMilliseconds(i));
                images[i].Size = images[i].Data.Length;
            }
            var stored = await _db.Feedback.Where(f => f.CreatedAt > since).SelectMany(f => f.Images).SumAsync(i => (long)i.Size, cancellationToken);
            if (stored + images.Sum(i => (long)i.Size) > MaxFeedbackImageBytesPerDay) return false;
        }

        if (userId is { } id && !await _db.Users.AnyAsync(u => u.Id == id, cancellationToken))
        {
            userId = null;
            images = null;
        }

        var feedback = new Feedback
        {
            UserId = userId,
            Platform = platform,
            Version = version,
            Title = title ?? DefaultTitle(text),
            Text = text,
            CreatedAt = now,
            Images = images is null ? [] : [.. images],
        };
        _db.Feedback.Add(feedback);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException) when (feedback.UserId is not null)
        {
            if (await _db.Users.AnyAsync(u => u.Id == feedback.UserId, cancellationToken)) throw;

            feedback.UserId = null;
            foreach (var image in feedback.Images) _db.Entry(image).State = EntityState.Detached;
            feedback.Images.Clear();
            await _db.SaveChangesAsync(cancellationToken);
        }

        return true;
    }

    private static string DefaultTitle(string text)
    {
        var line = text.ReplaceLineEndings("\n").Split('\n')[0].Replace('\t', ' ').TrimEnd();
        if (line.Length <= MaxFeedbackTitleLength) return line;
        return line[..(char.IsHighSurrogate(line[MaxFeedbackTitleLength - 1]) ? MaxFeedbackTitleLength - 1 : MaxFeedbackTitleLength)];
    }
}
