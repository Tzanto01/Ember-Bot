using Ember.Core.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>
/// The Discord side of <see cref="HabitService"/>: every user-scoped method keyed on a Discord user ID instead of
/// the Ember user ID. Each one resolves the Discord ID through <see cref="FindDiscordUserAsync"/> (reads, and
/// writes that need an existing user) or <see cref="ResolveOrCreateDiscordUserAsync"/> (writes that may create
/// the user), then calls the <see cref="Guid"/> overload. The lookup is never cached: the API can merge or delete
/// accounts while the bot runs. The API uses the <see cref="Guid"/> overloads only.
/// </summary>
public partial class HabitService
{
    /// <summary>
    /// The Ember user ID linked to this Discord user, or <see cref="Guid.Empty"/> when Ember stores nothing about them.
    /// Every user-scoped query with <see cref="Guid.Empty"/> matches nothing, so callers need no special case.
    /// </summary>
    public async Task<Guid> FindDiscordUserAsync(ulong discordUserId, CancellationToken cancellationToken = default)
    {
        var key = DiscordLogin.Key(discordUserId);
        return await _db.UserLogins
            .Where(l => l.LoginProvider == DiscordLogin.Provider && l.ProviderKey == key)
            .Select(l => l.UserId)
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// The Ember user ID linked to this Discord user, creating a bot-only user (no email, no password) when there is none.
    /// Safe against concurrent calls: losing the insert race to another request is not an error.
    /// </summary>
    public async Task<Guid> ResolveOrCreateDiscordUserAsync(ulong discordUserId, CancellationToken cancellationToken = default)
    {
        var existing = await FindDiscordUserAsync(discordUserId, cancellationToken);
        if (existing != Guid.Empty) return existing;

        var userName = DiscordLogin.UserName(discordUserId);
        var user = new User
        {
            Id = Guid.CreateVersion7(),
            UserName = userName,
            NormalizedUserName = userName.ToUpperInvariant(),
            SecurityStamp = Guid.NewGuid().ToString("N").ToUpperInvariant(),
            ConcurrencyStamp = Guid.NewGuid().ToString(),
        };
        user.Logins.Add(new IdentityUserLogin<Guid>
        {
            LoginProvider = DiscordLogin.Provider,
            ProviderKey = DiscordLogin.Key(discordUserId),
            ProviderDisplayName = DiscordLogin.Provider,
            UserId = user.Id,
        });
        _db.Users.Add(user);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
            return user.Id;
        }
        catch (DbUpdateException)
        {
            _db.Entry(user).State = EntityState.Detached;
            foreach (var login in user.Logins) _db.Entry(login).State = EntityState.Detached;
            var winner = await FindDiscordUserAsync(discordUserId, cancellationToken);
            if (winner == Guid.Empty) throw;
            return winner;
        }
    }

    public async Task<bool> HasHealthDataConsentAsync(ulong discordUserId)
        => await HasHealthDataConsentAsync(await FindDiscordUserAsync(discordUserId));

    public async Task GiveHealthDataConsentAsync(ulong discordUserId)
        => await GiveHealthDataConsentAsync(await ResolveOrCreateDiscordUserAsync(discordUserId));

    public async Task<bool> ClaimConsentPromptAsync(ulong discordUserId)
        => await ClaimConsentPromptAsync(await FindDiscordUserAsync(discordUserId));

    public async Task ReleaseConsentPromptAsync(ulong discordUserId)
        => await ReleaseConsentPromptAsync(await FindDiscordUserAsync(discordUserId));

    public async Task MarkConsentPromptedAsync(ulong discordUserId)
        => await MarkConsentPromptedAsync(await FindDiscordUserAsync(discordUserId));

    public async Task<Habit> AddHabitAsync(ulong discordUserId, string name, TimeOnly? reminderTime, FrequencyType frequency = FrequencyType.Daily, int? weeklyTarget = null)
        => await AddHabitAsync(await FindDiscordUserAsync(discordUserId), name, reminderTime, frequency, weeklyTarget);

    public async Task<Habit?> GetHabitAsync(ulong discordUserId, int habitId)
        => await GetHabitAsync(await FindDiscordUserAsync(discordUserId), habitId);

    public async Task<List<Habit>> GetHabitsAsync(ulong discordUserId)
        => await GetHabitsAsync(await FindDiscordUserAsync(discordUserId));

    public async Task<DayEditResult> CheckInAsync(ulong discordUserId, int habitId, DateOnly date, bool completed, ulong? guildId = null)
        => await CheckInAsync(await FindDiscordUserAsync(discordUserId), habitId, date, completed, guildId);

    public async Task<DayEditResult> ClearDayAsync(ulong discordUserId, int habitId, DateOnly date)
        => await ClearDayAsync(await FindDiscordUserAsync(discordUserId), habitId, date);

    public async Task<DayEditResult> SetLowDayAsync(ulong discordUserId, DateOnly date)
        => await SetLowDayAsync(await FindDiscordUserAsync(discordUserId), date);

    public async Task ClearLowDayAsync(ulong discordUserId, DateOnly date)
        => await ClearLowDayAsync(await FindDiscordUserAsync(discordUserId), date);

    public async Task<HashSet<DateOnly>> GetLowDaysAsync(ulong discordUserId)
        => await GetLowDaysAsync(await FindDiscordUserAsync(discordUserId));

    public async Task<IReadOnlyList<HabitDay>?> GetHabitDaysAsync(ulong discordUserId, int habitId, int days)
        => await GetHabitDaysAsync(await FindDiscordUserAsync(discordUserId), habitId, days);

    public async Task<Habit?> SetFrequencyAsync(ulong discordUserId, int habitId, FrequencyType type, int? weeklyTarget)
        => await SetFrequencyAsync(await FindDiscordUserAsync(discordUserId), habitId, type, weeklyTarget);

    public async Task<bool> DeleteHabitAsync(ulong discordUserId, int habitId)
        => await DeleteHabitAsync(await FindDiscordUserAsync(discordUserId), habitId);

    public async Task<Habit?> EditHabitAsync(ulong discordUserId, int habitId, string? newName, TimeOnly? newReminderTime, bool clearReminder)
        => await EditHabitAsync(await FindDiscordUserAsync(discordUserId), habitId, newName, newReminderTime, clearReminder);

    public async Task<bool> SnoozeReminderAsync(ulong discordUserId, int habitId, DateTimeOffset sentAtUtc)
        => await SnoozeReminderAsync(await FindDiscordUserAsync(discordUserId), habitId, sentAtUtc);

    public async Task<int> RescheduleRemindersAsync(ulong discordUserId)
        => await RescheduleRemindersAsync(await FindDiscordUserAsync(discordUserId));

    public async Task<bool> ClaimDmPauseNoticeAsync(ulong discordUserId)
        => await ClaimDmPauseNoticeAsync(await FindDiscordUserAsync(discordUserId));

    public async Task DeleteUserDataAsync(ulong discordUserId)
        => await DeleteUserDataAsync(await FindDiscordUserAsync(discordUserId));

    public async Task ReleaseDmPauseNoticeAsync(ulong discordUserId)
        => await ReleaseDmPauseNoticeAsync(await FindDiscordUserAsync(discordUserId));

    public async Task ResumeDmRemindersAsync(ulong discordUserId)
        => await ResumeDmRemindersAsync(await FindDiscordUserAsync(discordUserId));

    public async Task<Habit?> PauseHabitAsync(ulong discordUserId, int habitId, DateOnly? pausedUntil)
        => await PauseHabitAsync(await FindDiscordUserAsync(discordUserId), habitId, pausedUntil);

    public async Task<int> GetGraceDaysAsync(ulong discordUserId)
        => await GetGraceDaysAsync(await FindDiscordUserAsync(discordUserId));

    public async Task SetGraceDaysAsync(ulong discordUserId, int graceDays)
        => await SetGraceDaysAsync(await ResolveOrCreateDiscordUserAsync(discordUserId), graceDays);

    public async Task SetLeaderboardOptInAsync(ulong discordUserId, bool optIn)
        => await SetLeaderboardOptInAsync(optIn ? await ResolveOrCreateDiscordUserAsync(discordUserId) : await FindDiscordUserAsync(discordUserId), optIn);

    public async Task<TimeZoneInfo> GetUserTzAsync(ulong discordUserId)
        => await GetUserTzAsync(await FindDiscordUserAsync(discordUserId));

    public async Task<DateOnly> GetLocalTodayAsync(ulong discordUserId)
        => await GetLocalTodayAsync(await FindDiscordUserAsync(discordUserId));

    public async Task<bool> HasTimezoneSetAsync(ulong discordUserId)
        => await HasTimezoneSetAsync(await FindDiscordUserAsync(discordUserId));

    public async Task SetTimezoneAsync(ulong discordUserId, string timezoneId)
        => await SetTimezoneAsync(await ResolveOrCreateDiscordUserAsync(discordUserId), timezoneId);

    public async Task<User?> GetUserForExportAsync(ulong discordUserId)
        => await GetUserForExportAsync(await FindDiscordUserAsync(discordUserId));

    public async Task<bool> UserExistsAsync(ulong discordUserId, CancellationToken cancellationToken = default)
        => await UserExistsAsync(await FindDiscordUserAsync(discordUserId, cancellationToken), cancellationToken);
}
