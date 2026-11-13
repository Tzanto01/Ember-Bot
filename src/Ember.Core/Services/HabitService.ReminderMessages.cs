using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>Second reminders and the Discord reminder messages whose buttons are still open.</summary>
public partial class HabitService
{
    /// <summary>Remembers a sent Discord reminder message until it is closed.</summary>
    public async Task AddReminderMessageAsync(ReminderMessage message, CancellationToken cancellationToken = default)
    {
        _db.ReminderMessages.Add(message);
        await _db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>The open reminder messages (untracked) of the habit or routine for the local day <paramref name="date"/>.</summary>
    public Task<List<ReminderMessage>> GetReminderMessagesAsync(int? habitId, int? routineId, DateOnly date,
        CancellationToken cancellationToken = default)
        => _db.ReminderMessages
            .AsNoTracking()
            .Where(m => m.HabitId == habitId && m.RoutineId == routineId && m.Date == date)
            .ToListAsync(cancellationToken);

    /// <summary>
    /// Every open reminder message (untracked) with its user's timezone id, whether that habit is done on the message's day for a
    /// habit's message (always false for a routine's message) and the user's language, in one query.
    /// </summary>
    public async Task<List<(ReminderMessage Message, string Timezone, bool HabitDone, string Language)>> GetOpenReminderMessagesAsync(
        CancellationToken cancellationToken = default)
    {
        var rows = await _db.ReminderMessages
            .AsNoTracking()
            .Join(_db.Users, m => m.UserId, u => u.Id, (m, u) => new
            {
                Message = m,
                u.Timezone,
                HabitDone = m.HabitId != null && _db.HabitLogs.Any(l => l.HabitId == m.HabitId && l.Date == m.Date && l.Completed),
                u.Language,
            })
            .ToListAsync(cancellationToken);
        return rows.Select(r => (r.Message, r.Timezone, r.HabitDone, r.Language)).ToList();
    }

    /// <summary>Forgets the reminder message with the database id <paramref name="id"/>.</summary>
    public Task DeleteReminderMessageAsync(int id, CancellationToken cancellationToken = default)
        => _db.ReminderMessages.Where(m => m.Id == id).ExecuteDeleteAsync(cancellationToken);

    /// <summary>Forgets the reminder message with the Discord message id <paramref name="messageId"/>, if it is remembered.</summary>
    public Task DeleteReminderMessageByDiscordIdAsync(ulong messageId, CancellationToken cancellationToken = default)
        => _db.ReminderMessages.Where(m => m.MessageId == messageId).ExecuteDeleteAsync(cancellationToken);

    /// <summary>Ids of habits whose pending second reminder is due at or before <paramref name="nowUtc"/>.</summary>
    public Task<List<int>> GetDueSecondReminderHabitIdsAsync(DateTime nowUtc, CancellationToken cancellationToken = default)
        => _db.Habits
            .Where(h => h.SecondReminderUtc != null && h.SecondReminderUtc <= nowUtc)
            .Select(h => h.Id)
            .ToListAsync(cancellationToken);

    /// <summary>Ids of routines whose pending second reminder is due at or before <paramref name="nowUtc"/>.</summary>
    public Task<List<int>> GetDueSecondReminderRoutineIdsAsync(DateTime nowUtc, CancellationToken cancellationToken = default)
        => _db.Routines
            .Where(r => r.SecondReminderUtc != null && r.SecondReminderUtc <= nowUtc)
            .Select(r => r.Id)
            .ToListAsync(cancellationToken);

    /// <summary>Drops the habit's pending second reminder directly in the database.</summary>
    public Task ClearSecondReminderAsync(int habitId, CancellationToken cancellationToken = default)
        => _db.Habits
            .Where(h => h.Id == habitId)
            .ExecuteUpdateAsync(s => s.SetProperty(h => h.SecondReminderUtc, (DateTime?)null), cancellationToken);

    /// <summary>Drops the routine's pending second reminder directly in the database.</summary>
    public Task ClearRoutineSecondReminderAsync(int routineId, CancellationToken cancellationToken = default)
        => _db.Routines
            .Where(r => r.Id == routineId)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.SecondReminderUtc, (DateTime?)null), cancellationToken);

    /// <summary>Sets the account's <see cref="User.SecondReminderMinutes"/> (one of <see cref="User.SecondReminderChoices"/>).</summary>
    public async Task SetSecondReminderMinutesAsync(Guid userId, int minutes)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.SecondReminderMinutes, minutes));
    }

    public async Task SetSecondReminderMinutesAsync(ulong discordUserId, int minutes)
        => await SetSecondReminderMinutesAsync(await ResolveOrCreateDiscordUserAsync(discordUserId), minutes);

    /// <summary>The account's <see cref="User.ShowStreaks"/>; false when there is no account.</summary>
    public async Task<bool> GetShowStreaksAsync(Guid userId)
        => await _db.Users.Where(u => u.Id == userId).Select(u => u.ShowStreaks).FirstOrDefaultAsync();

    public async Task<bool> GetShowStreaksAsync(ulong discordUserId)
        => await GetShowStreaksAsync(await FindDiscordUserAsync(discordUserId));

    /// <summary>Sets the account's <see cref="User.ShowStreaks"/>.</summary>
    public async Task SetShowStreaksAsync(Guid userId, bool show)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.ShowStreaks, show));
    }

    public async Task SetShowStreaksAsync(ulong discordUserId, bool show)
        => await SetShowStreaksAsync(await ResolveOrCreateDiscordUserAsync(discordUserId), show);
}
