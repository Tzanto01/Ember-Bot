using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>In-app feedback, sent from the API (web, Android) and the bot (Discord).</summary>
public partial class HabitService
{
    /// <summary>Most characters (UTF-16 code units) a feedback text can have after trimming.</summary>
    public const int MaxFeedbackLength = 2000;

    /// <summary>
    /// Why a feedback text can't be stored, or null when it can. <paramref name="text"/> must already be trimmed. Rejects an
    /// empty text, one over <see cref="MaxFeedbackLength"/>, control characters other than tab, line feed and carriage return,
    /// and unpaired UTF-16 surrogates.
    /// </summary>
    public static string? FeedbackTextError(string text)
    {
        if (text.Length == 0) return "Required.";
        if (text.Length > MaxFeedbackLength) return $"At most {MaxFeedbackLength} characters.";

        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (char.IsControl(c) && c is not ('\n' or '\r' or '\t')) return "Contains characters that aren't allowed.";
            if (char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) i++;
            else if (char.IsSurrogate(c)) return "Contains characters that aren't allowed.";
        }

        return null;
    }

    /// <summary>
    /// Stores one feedback, sent now. <paramref name="userId"/> is kept only while that user exists; when the user is deleted or
    /// merged away in the meantime the feedback is stored without one. The caller validates the input
    /// (<see cref="FeedbackTextError"/>, trimmed text).
    /// </summary>
    /// <param name="platform"><c>web</c>, <c>android</c> or <c>discord</c>.</param>
    public async Task SaveFeedbackAsync(Guid? userId, string platform, string? version, string text, CancellationToken cancellationToken = default)
    {
        if (userId is { } id && !await _db.Users.AnyAsync(u => u.Id == id, cancellationToken)) userId = null;

        var feedback = new Feedback
        {
            UserId = userId,
            Platform = platform,
            Version = version,
            Text = text,
            CreatedAt = _time.GetUtcNow().UtcDateTime,
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
    }
}
