using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>
/// Merging a bot-only account (no email, no password) into the web account that links its Discord login.
/// Needs PostgreSQL: the merge locks both user rows.
/// </summary>
public partial class HabitService
{
    /// <summary>
    /// What merging <paramref name="sourceUserId"/> would move, or null when it is no longer a bot-only account
    /// owning the Discord login of <paramref name="discordUserId"/>.
    /// </summary>
    public async Task<MergePreview?> GetMergePreviewAsync(Guid sourceUserId, ulong discordUserId, CancellationToken cancellationToken = default)
    {
        if (!await IsMergeableSourceAsync(sourceUserId, discordUserId, cancellationToken)) return null;

        var habitNames = await _db.Habits
            .Where(h => h.UserId == sourceUserId)
            .OrderBy(h => h.Id)
            .Select(h => h.Name)
            .ToListAsync(cancellationToken);
        var logs = await _db.HabitLogs.CountAsync(l => l.Habit.UserId == sourceUserId, cancellationToken);
        var dayMarks = await _db.DayMarks.CountAsync(m => m.UserId == sourceUserId, cancellationToken);
        return new MergePreview(habitNames.Count, logs, dayMarks, habitNames);
    }

    /// <summary>
    /// In one transaction, after locking both user rows and re-checking that the source is still a bot-only account
    /// owning the Discord login and the target still has no Discord login: moves the source's habits (with their logs),
    /// routines, day marks (one per day and kind when both have it), journal entries (the target's wins on a date both have),
    /// own moods, journal key, push subscriptions (a subscription without a session joins <paramref name="sessionId"/>), feedback and Discord login to the target, deletes the source and gives
    /// the target a new security stamp. A plaintext source mood whose trimmed label matches a plaintext target mood
    /// (ignoring case) is combined into it: the source's entries pointing at it point at the target's mood and the source mood
    /// is dropped (skipped when the source has encrypted entries, which may reference it inside the ciphertext).
    /// The habit and routine limits do not apply. The target's settings are kept; the caller reschedules the target's reminders. Returns <see cref="AccountMergeResult.JournalConflict"/>
    /// without changes when both accounts have a journal key.
    /// </summary>
    public async Task<AccountMergeResult> MergeBotOnlyAccountAsync(Guid targetUserId, Guid sourceUserId, ulong discordUserId,
        Guid? sessionId = null, CancellationToken cancellationToken = default)
    {
        if (targetUserId == sourceUserId) return AccountMergeResult.Conflict;

        await using (var transaction = await _db.Database.BeginTransactionAsync(cancellationToken))
        {
            await _db.Database.ExecuteSqlAsync(
                $"""SELECT 1 FROM "AspNetUsers" WHERE "Id" IN ({targetUserId}, {sourceUserId}) ORDER BY "Id" FOR UPDATE""",
                cancellationToken);

            if (!await _db.Users.AnyAsync(u => u.Id == targetUserId, cancellationToken)
                || await _db.UserLogins.AnyAsync(l => l.UserId == targetUserId && l.LoginProvider == DiscordLogin.Provider, cancellationToken)
                || !await IsMergeableSourceAsync(sourceUserId, discordUserId, cancellationToken))
                return AccountMergeResult.Conflict;

            if (await _db.JournalKeys.CountAsync(k => k.UserId == targetUserId || k.UserId == sourceUserId, cancellationToken) == 2)
                return AccountMergeResult.JournalConflict;

            await _db.Habits
                .Where(h => h.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(h => h.UserId, targetUserId), cancellationToken);

            await _db.Routines
                .Where(r => r.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.UserId, targetUserId), cancellationToken);

            await MergeMoodsAsync(targetUserId, sourceUserId, cancellationToken);

            await _db.DayNotes
                .Where(n => n.UserId == sourceUserId && _db.DayNotes.Any(t => t.UserId == targetUserId && t.Date == n.Date))
                .ExecuteDeleteAsync(cancellationToken);
            await _db.DayNotes
                .Where(n => n.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.UserId, targetUserId), cancellationToken);

            await _db.JournalKeys
                .Where(k => k.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(k => k.UserId, targetUserId), cancellationToken);

            await _db.DayMarks
                .Where(m => m.UserId == sourceUserId
                    && _db.DayMarks.Any(t => t.UserId == targetUserId && t.Date == m.Date && t.Kind == m.Kind))
                .ExecuteDeleteAsync(cancellationToken);
            await _db.DayMarks
                .Where(m => m.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.UserId, targetUserId), cancellationToken);

            await _db.PushSubscriptions
                .Where(s => s.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.UserId, targetUserId).SetProperty(p => p.SessionId, p => p.SessionId ?? sessionId), cancellationToken);
            await TrimPushSubscriptionsAsync(targetUserId, cancellationToken);

            var key = DiscordLogin.Key(discordUserId);
            await _db.UserLogins
                .Where(l => l.LoginProvider == DiscordLogin.Provider && l.ProviderKey == key)
                .ExecuteUpdateAsync(s => s.SetProperty(l => l.UserId, targetUserId), cancellationToken);

            await _db.ReminderMessages.Where(m => m.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.UserId, targetUserId), cancellationToken);
            await _db.ReminderActionTokens.Where(t => t.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.UserId, targetUserId), cancellationToken);
            await _db.Feedback.Where(f => f.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(f => f.UserId, targetUserId), cancellationToken);

            await _db.Users.Where(u => u.Id == sourceUserId).ExecuteDeleteAsync(cancellationToken);

            var securityStamp = Guid.NewGuid().ToString("N").ToUpperInvariant();
            var concurrencyStamp = Guid.NewGuid().ToString();
            await _db.Users
                .Where(u => u.Id == targetUserId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(u => u.SecurityStamp, securityStamp)
                    .SetProperty(u => u.ConcurrencyStamp, concurrencyStamp), cancellationToken);

            await transaction.CommitAsync(cancellationToken);
        }

        return AccountMergeResult.Merged;
    }

    private async Task MergeMoodsAsync(Guid targetUserId, Guid sourceUserId, CancellationToken cancellationToken)
    {
        if (!await _db.DayNotes.AnyAsync(n => n.UserId == sourceUserId && n.CipherVersion != null, cancellationToken))
        {
            var plaintext = await _db.Moods
                .Where(m => (m.UserId == targetUserId || m.UserId == sourceUserId) && m.CipherVersion == null && m.Label != null)
                .OrderBy(m => m.Id)
                .Select(m => new { m.Id, m.UserId, m.Label })
                .ToListAsync(cancellationToken);
            foreach (var source in plaintext.Where(m => m.UserId == sourceUserId))
            {
                var target = plaintext.FirstOrDefault(m => m.UserId == targetUserId
                    && string.Equals(m.Label!.Trim(), source.Label!.Trim(), StringComparison.OrdinalIgnoreCase));
                if (target is null) continue;

                var (from, to) = ($"custom:{source.Id}", $"custom:{target.Id}");
                await _db.DayNotes
                    .Where(n => n.UserId == sourceUserId && n.Mood == from)
                    .ExecuteUpdateAsync(s => s.SetProperty(n => n.Mood, to), cancellationToken);
                await _db.Moods.Where(m => m.Id == source.Id).ExecuteDeleteAsync(cancellationToken);
            }
        }

        await _db.Moods
            .Where(m => m.UserId == sourceUserId)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.UserId, targetUserId), cancellationToken);
    }

    private async Task<bool> IsMergeableSourceAsync(Guid sourceUserId, ulong discordUserId, CancellationToken cancellationToken)
        => await _db.Users.AnyAsync(u => u.Id == sourceUserId && u.PasswordHash == null && u.Email == null && !u.TwoFactorEnabled, cancellationToken)
           && await FindDiscordUserAsync(discordUserId, cancellationToken) == sourceUserId;
}
