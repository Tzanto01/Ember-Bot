using System.Globalization;
using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>Reminder destinations: Discord DMs, browsers (push subscriptions) and phones, the Discord ask and delivered web push reminders.</summary>
public partial class HabitService
{
    /// <summary>Most phones a single user keeps; registering another drops the least recently registered.</summary>
    public const int MaxReminderPhonesPerUser = 10;

    /// <summary>Most users <see cref="GetDiscordAskUserIdsAsync"/> returns per call.</summary>
    public const int MaxDiscordAsksPerRun = 20;

    /// <summary>The user (untracked) with logins, push subscriptions and phones, or null.</summary>
    public Task<User?> GetUserWithDestinationsAsync(Guid userId, CancellationToken cancellationToken = default)
        => _db.Users
            .AsNoTracking()
            .Include(u => u.Logins)
            .Include(u => u.PushSubscriptions)
            .Include(u => u.ReminderPhones)
            .AsSplitQuery()
            .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);

    /// <summary>
    /// Turns the user's destination <paramref name="id"/> on or off. For <see cref="ReminderDestinations.Discord"/> it records the
    /// account's answer (<see cref="User.DiscordReminders"/>) and needs a Discord login. False when the id is malformed or names no
    /// destination of this user.
    /// </summary>
    public async Task<bool> SetReminderDestinationAsync(Guid userId, string id, bool enabled)
    {
        if (id == ReminderDestinations.Discord)
            return await _db.Users
                .Where(u => u.Id == userId && _db.UserLogins.Any(l => l.UserId == userId && l.LoginProvider == DiscordLogin.Provider))
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.DiscordReminders, enabled)) == 1;
        if (ParseId(id, ReminderDestinations.BrowserPrefix) is { } subscriptionId)
            return await _db.PushSubscriptions
                .Where(s => s.Id == subscriptionId && s.UserId == userId)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.Enabled, enabled)) == 1;
        if (ParseId(id, ReminderDestinations.PhonePrefix) is { } phoneId)
            return await _db.ReminderPhones
                .Where(p => p.Id == phoneId && p.UserId == userId)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.Enabled, enabled)) == 1;
        return false;
    }

    /// <summary>The number after <paramref name="prefix"/> when <paramref name="id"/> is exactly that prefix and a positive id in canonical form.</summary>
    private static int? ParseId(string id, string prefix)
        => id.StartsWith(prefix, StringComparison.Ordinal)
            && int.TryParse(id.AsSpan(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out var value)
            && value > 0 && id == prefix + value.ToString(CultureInfo.InvariantCulture)
                ? value
                : null;

    /// <summary>
    /// Registers the phone with <paramref name="installId"/> for the user and <paramref name="sessionId"/>. A phone already registered
    /// by this user keeps its id and <see cref="ReminderPhone.Enabled"/> and gets the new label and session; one registered by another
    /// account is removed there and registered anew (enabled) here. Afterwards the user keeps at most <see cref="MaxReminderPhonesPerUser"/>
    /// phones; the least recently registered beyond that are deleted.
    /// </summary>
    public async Task<ReminderPhone> SaveReminderPhoneAsync(Guid userId, string installId, string label, Guid sessionId)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        var phone = await _db.ReminderPhones.FirstOrDefaultAsync(p => p.InstallId == installId);
        if (phone is not null && phone.UserId != userId)
        {
            _db.ReminderPhones.Remove(phone);
            await _db.SaveChangesAsync();
            phone = null;
        }
        if (phone is null)
        {
            phone = new ReminderPhone { UserId = userId, InstallId = installId };
            _db.ReminderPhones.Add(phone);
        }

        phone.Label = label;
        phone.SessionId = sessionId;
        phone.CreatedAt = now;
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (_db.Entry(phone).State == EntityState.Added)
        {
            _db.Entry(phone).State = EntityState.Detached;
            await _db.ReminderPhones.Where(p => p.InstallId == installId && p.UserId != userId).ExecuteDeleteAsync();
            var updated = await _db.ReminderPhones
                .Where(p => p.InstallId == installId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.Label, label)
                    .SetProperty(p => p.SessionId, sessionId)
                    .SetProperty(p => p.CreatedAt, now));
            if (updated == 0)
            {
                phone = new ReminderPhone { UserId = userId, InstallId = installId, Label = label, SessionId = sessionId, CreatedAt = now };
                _db.ReminderPhones.Add(phone);
                await _db.SaveChangesAsync();
            }
            else
            {
                phone = await _db.ReminderPhones.AsNoTracking().FirstAsync(p => p.InstallId == installId);
            }
        }

        await TrimReminderPhonesAsync(userId);
        return phone;
    }

    /// <summary>Deletes the user's least recently registered phones beyond <see cref="MaxReminderPhonesPerUser"/>.</summary>
    private async Task TrimReminderPhonesAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var excess = await _db.ReminderPhones
            .Where(p => p.UserId == userId)
            .OrderByDescending(p => p.CreatedAt).ThenByDescending(p => p.Id)
            .Skip(MaxReminderPhonesPerUser)
            .Select(p => p.Id)
            .ToListAsync(cancellationToken);
        if (excess.Count > 0)
            await _db.ReminderPhones.Where(p => excess.Contains(p.Id)).ExecuteDeleteAsync(cancellationToken);
    }

    /// <summary>
    /// Bot only: up to <see cref="MaxDiscordAsksPerRun"/> users with a Discord login who never answered or were asked about Discord
    /// reminders and have a habit with reminder times or a routine with a reminder time, with their Discord ids.
    /// </summary>
    public async Task<List<(Guid UserId, ulong DiscordUserId)>> GetDiscordAskUserIdsAsync(CancellationToken cancellationToken = default)
    {
        var rows = await _db.Users
            .Where(u => u.DiscordReminders == null && u.DiscordRemindersAskedAt == null
                && (u.Habits.Any(h => h.ReminderTimes.Count > 0) || u.Routines.Any(r => r.ReminderTime != null)))
            .SelectMany(u => u.Logins.Where(l => l.LoginProvider == DiscordLogin.Provider), (u, l) => new { u.Id, l.ProviderKey })
            .OrderBy(r => r.Id)
            .Take(MaxDiscordAsksPerRun)
            .ToListAsync(cancellationToken);
        return rows.Select(r => (r.Id, ulong.Parse(r.ProviderKey, CultureInfo.InvariantCulture))).ToList();
    }

    /// <summary>Bot only: records that the user was asked about Discord reminders, so they are never asked again.</summary>
    public Task MarkDiscordRemindersAskedAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        return _db.Users.Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.DiscordRemindersAskedAt, now), cancellationToken);
    }

    /// <summary>Records the answer of the Discord user's account to "remind me in Discord DMs" (latest answer wins).</summary>
    public async Task SetDiscordRemindersAsync(ulong discordUserId, bool enabled)
    {
        var userId = await FindDiscordUserAsync(discordUserId);
        await _db.Users.Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.DiscordReminders, enabled));
    }

    /// <summary>Bot only: remembers that the habit's or routine's reminder for <paramref name="date"/> was delivered by web push (at most once).</summary>
    public async Task AddPushReminderAsync(Guid userId, int? habitId, int? routineId, DateOnly date, CancellationToken cancellationToken = default)
    {
        if (await _db.PushReminders.AnyAsync(r => r.UserId == userId && r.HabitId == habitId && r.RoutineId == routineId && r.Date == date,
                cancellationToken))
            return;
        _db.PushReminders.Add(new PushReminder { UserId = userId, HabitId = habitId, RoutineId = routineId, Date = date });
        await _db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Bot only: every remembered web push reminder (untracked) with its user's timezone id and, for a habit's, whether that habit
    /// is done on the reminder's day (always false for a routine's), in one query.
    /// </summary>
    public async Task<List<(PushReminder Reminder, string Timezone, bool HabitDone)>> GetPushRemindersAsync(
        CancellationToken cancellationToken = default)
    {
        var rows = await _db.PushReminders
            .AsNoTracking()
            .Join(_db.Users, r => r.UserId, u => u.Id, (r, u) => new
            {
                Reminder = r,
                u.Timezone,
                HabitDone = r.HabitId != null && _db.HabitLogs.Any(l => l.HabitId == r.HabitId && l.Date == r.Date && l.Completed),
            })
            .ToListAsync(cancellationToken);
        return rows.Select(r => (r.Reminder, r.Timezone, r.HabitDone)).ToList();
    }

    /// <summary>Bot only: forgets the remembered web push reminder with the database id <paramref name="id"/>.</summary>
    public Task DeletePushReminderAsync(int id, CancellationToken cancellationToken = default)
        => _db.PushReminders.Where(r => r.Id == id).ExecuteDeleteAsync(cancellationToken);
}
