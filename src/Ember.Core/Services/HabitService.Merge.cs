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
    /// day marks (one per day and kind when both have it), push subscriptions and Discord login to the target, deletes the source and gives
    /// the target a new security stamp. The habit limit does not apply. Then reschedules the target's reminders in the
    /// target's timezone. The target's settings are kept.
    /// </summary>
    public async Task<AccountMergeResult> MergeBotOnlyAccountAsync(Guid targetUserId, Guid sourceUserId, ulong discordUserId,
        CancellationToken cancellationToken = default)
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

            await _db.Habits
                .Where(h => h.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(h => h.UserId, targetUserId), cancellationToken);

            await _db.DayMarks
                .Where(m => m.UserId == sourceUserId
                    && _db.DayMarks.Any(t => t.UserId == targetUserId && t.Date == m.Date && t.Kind == m.Kind))
                .ExecuteDeleteAsync(cancellationToken);
            await _db.DayMarks
                .Where(m => m.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.UserId, targetUserId), cancellationToken);

            await _db.PushSubscriptions
                .Where(s => s.UserId == sourceUserId)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.UserId, targetUserId), cancellationToken);

            var key = DiscordLogin.Key(discordUserId);
            await _db.UserLogins
                .Where(l => l.LoginProvider == DiscordLogin.Provider && l.ProviderKey == key)
                .ExecuteUpdateAsync(s => s.SetProperty(l => l.UserId, targetUserId), cancellationToken);

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

        await RescheduleRemindersAsync(targetUserId);
        return AccountMergeResult.Merged;
    }

    private async Task<bool> IsMergeableSourceAsync(Guid sourceUserId, ulong discordUserId, CancellationToken cancellationToken)
        => await _db.Users.AnyAsync(u => u.Id == sourceUserId && u.PasswordHash == null && u.Email == null, cancellationToken)
           && await FindDiscordUserAsync(discordUserId, cancellationToken) == sourceUserId;
}
