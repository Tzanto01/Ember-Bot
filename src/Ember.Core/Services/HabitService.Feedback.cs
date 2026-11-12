using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>In-app feedback, sent from the API (web, Android) and the bot (Discord).</summary>
public partial class HabitService
{
    /// <summary>Most characters (UTF-16 code units) a feedback text can have after trimming.</summary>
    public const int MaxFeedbackLength = 2000;

    /// <summary>Most feedback stored in any 24 hours, across every platform; also the most one digest email carries.</summary>
    public const int MaxFeedbackPerDay = 300;

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
    /// Stores one feedback, submitted now, and returns true; returns false and stores nothing when <see cref="MaxFeedbackPerDay"/>
    /// were already submitted in the last 24 hours. <paramref name="userId"/> is kept only while that user exists; when the user
    /// is deleted or merged away in the meantime the feedback is stored without one. The caller validates the input
    /// (<see cref="FeedbackTextError"/>, trimmed text).
    /// </summary>
    /// <param name="platform"><c>web</c>, <c>android</c> or <c>discord</c>.</param>
    public async Task<bool> SaveFeedbackAsync(Guid? userId, string platform, string? version, string text, CancellationToken cancellationToken = default)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        var since = now.AddHours(-24);
        if (await _db.Feedback.CountAsync(f => f.CreatedAt > since, cancellationToken) >= MaxFeedbackPerDay) return false;

        if (userId is { } id && !await _db.Users.AnyAsync(u => u.Id == id, cancellationToken)) userId = null;

        var feedback = new Feedback
        {
            UserId = userId,
            Platform = platform,
            Version = version,
            Text = text,
            CreatedAt = now,
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
            await _db.SaveChangesAsync(cancellationToken);
        }

        return true;
    }
}
