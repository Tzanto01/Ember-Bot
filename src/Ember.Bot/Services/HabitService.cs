using Ember.Bot.Data;
using Ember.Bot.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Bot.Services;

public class HabitService
{
    /// <summary>Most habits a single user can track.</summary>
    public const int MaxHabitsPerUser = 25;

    /// <summary>How long the Snooze button delays a reminder.</summary>
    public static readonly TimeSpan SnoozeDelay = TimeSpan.FromMinutes(60);

    /// <summary>
    /// Version of the privacy policy the health-data consent refers to. Consent given for an
    /// older version no longer counts, so changing this asks every user again.
    /// </summary>
    public const string CurrentConsentPolicyVersion = "2026-10";

    private readonly EmberDbContext _db;
    private readonly TimeProvider _time;

    public HabitService(EmberDbContext db, TimeProvider time)
    {
        _db   = db;
        _time = time;
    }

    /// <summary>
    /// Ensures a User row exists for this Discord user. Safe against concurrent calls:
    /// losing the insert race to another request is not an error.
    /// </summary>
    public async Task EnsureUserAsync(ulong discordUserId)
    {
        var id = (long)discordUserId;
        if (await _db.Users.AnyAsync(u => u.DiscordUserId == id)) return;

        var user = new User { DiscordUserId = id };
        _db.Users.Add(user);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            _db.Entry(user).State = EntityState.Detached;
            if (!await _db.Users.AnyAsync(u => u.DiscordUserId == id)) throw;
        }
    }

    /// <summary>Whether the user agreed to the current health-data consent (<see cref="CurrentConsentPolicyVersion"/>).</summary>
    public async Task<bool> HasHealthDataConsentAsync(ulong discordUserId)
        => await _db.Users.AnyAsync(u => u.DiscordUserId == (long)discordUserId
            && u.HealthDataConsentAt != null && u.ConsentPolicyVersion == CurrentConsentPolicyVersion);

    /// <summary>Records the user's explicit consent (now, for <see cref="CurrentConsentPolicyVersion"/>), creating the user if needed.</summary>
    public async Task GiveHealthDataConsentAsync(ulong discordUserId)
    {
        await EnsureUserAsync(discordUserId);
        var now = _time.GetUtcNow().UtcDateTime;
        await _db.Users
            .Where(u => u.DiscordUserId == (long)discordUserId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.HealthDataConsentAt, now)
                .SetProperty(u => u.ConsentPolicyVersion, CurrentConsentPolicyVersion));
    }

    /// <summary>
    /// For a user who already has habits but no current consent: marks today's consent prompt as shown and
    /// returns true, at most once per local day. Returns false for everyone else.
    /// </summary>
    public async Task<bool> ClaimConsentPromptAsync(ulong discordUserId)
    {
        var today = await GetLocalTodayAsync(discordUserId);
        return await _db.Users
            .Where(u => u.DiscordUserId == (long)discordUserId && u.Habits.Any()
                && (u.HealthDataConsentAt == null || u.ConsentPolicyVersion != CurrentConsentPolicyVersion)
                && (u.ConsentPromptedOn == null || u.ConsentPromptedOn != today))
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.ConsentPromptedOn, today)) == 1;
    }

    /// <summary>Notes that the consent prompt was shown today. Never creates a user.</summary>
    public async Task MarkConsentPromptedAsync(ulong discordUserId)
    {
        var today = await GetLocalTodayAsync(discordUserId);
        await _db.Users
            .Where(u => u.DiscordUserId == (long)discordUserId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.ConsentPromptedOn, today));
    }

    /// <exception cref="ConsentRequiredException">The user hasn't agreed to the current health-data consent.</exception>
    /// <exception cref="HabitLimitReachedException">The user already tracks <see cref="MaxHabitsPerUser"/> habits.</exception>
    public async Task<Habit> AddHabitAsync(ulong discordUserId, string name, TimeOnly? reminderTime,
        FrequencyType frequency = FrequencyType.Daily, int? weeklyTarget = null)
    {
        if (!await HasHealthDataConsentAsync(discordUserId))
            throw new ConsentRequiredException();
        if (await _db.Habits.CountAsync(h => h.UserId == (long)discordUserId) >= MaxHabitsPerUser)
            throw new HabitLimitReachedException();

        var habit = new Habit
        {
            UserId = (long)discordUserId,
            Name = name,
            ReminderTime = reminderTime,
            FrequencyType = frequency,
            WeeklyTarget = frequency == FrequencyType.Weekly ? (weeklyTarget ?? 3) : null,
            CreatedAt = _time.GetUtcNow().UtcDateTime
        };
        habit.NextReminderUtc = NextReminderUtc(habit, await GetUserTzAsync(discordUserId));
        _db.Habits.Add(habit);
        await _db.SaveChangesAsync();

        return habit;
    }

    public async Task<Habit?> GetHabitAsync(ulong discordUserId, int habitId)
    {
        return await _db.Habits
            .Include(h => h.Logs)
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == (long)discordUserId);
    }

    public async Task<List<Habit>> GetHabitsAsync(ulong discordUserId)
    {
        return await _db.Habits
            .Where(h => h.UserId == (long)discordUserId)
            .Include(h => h.Logs)
            .OrderBy(h => h.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Logs the habit as done or not done on the user's local <paramref name="date"/>, replacing any earlier log of that day.
    /// Any day from the habit's local start day (<see cref="StartDate"/>) to the user's local today can be logged,
    /// so past days can be backfilled or corrected; future days are refused.
    /// </summary>
    public async Task<DayEditResult> CheckInAsync(ulong discordUserId, int habitId, DateOnly date, bool completed, ulong? guildId = null)
    {
        var (habit, result) = await FindEditableHabitAsync(discordUserId, habitId, date);
        if (habit is null) return result;

        var existing = await _db.HabitLogs
            .FirstOrDefaultAsync(l => l.HabitId == habitId && l.Date == date);

        if (existing is null)
        {
            var log = new HabitLog
            {
                HabitId = habitId,
                Date = date,
                Completed = completed,
                GuildId = guildId.HasValue ? (long)guildId.Value : null
            };
            _db.HabitLogs.Add(log);
            try
            {
                await _db.SaveChangesAsync();
                return DayEditResult.Saved;
            }
            catch (DbUpdateException)
            {
                _db.Entry(log).State = EntityState.Detached;
                existing = await _db.HabitLogs
                    .FirstOrDefaultAsync(l => l.HabitId == habitId && l.Date == date);
                if (existing is null) throw;
            }
        }

        existing.Completed = completed;
        if (guildId.HasValue) existing.GuildId = (long)guildId.Value;
        await _db.SaveChangesAsync();
        return DayEditResult.Saved;
    }

    /// <summary>
    /// Removes the habit's log for the user's local <paramref name="date"/>, so the day is unlogged again.
    /// Same day range as <see cref="CheckInAsync"/>; clearing a day without a log is a no-op that still returns <see cref="DayEditResult.Saved"/>.
    /// </summary>
    public async Task<DayEditResult> ClearDayAsync(ulong discordUserId, int habitId, DateOnly date)
    {
        var (habit, result) = await FindEditableHabitAsync(discordUserId, habitId, date);
        if (habit is null) return result;

        await _db.HabitLogs.Where(l => l.HabitId == habitId && l.Date == date).ExecuteDeleteAsync();
        return DayEditResult.Saved;
    }

    /// <summary>
    /// Marks the user's local <paramref name="date"/> as a low day for all their habits (see <see cref="ConsecutiveStreak"/>
    /// and <see cref="FlexibleStreak"/>). Any day up to the user's local today can be marked; marking it again is a no-op.
    /// Needs the health-data consent, since a low day can say something about the user's health.
    /// </summary>
    public async Task<DayEditResult> SetLowDayAsync(ulong discordUserId, DateOnly date)
    {
        if (!await HasHealthDataConsentAsync(discordUserId)) return DayEditResult.ConsentRequired;
        if (date > await GetLocalTodayAsync(discordUserId)) return DayEditResult.InFuture;

        var userId = (long)discordUserId;
        if (await IsLowDayStoredAsync(userId, date)) return DayEditResult.Saved;

        var mark = new DayMark { UserId = userId, Date = date, Kind = DayMarkKind.LowDay };
        _db.DayMarks.Add(mark);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            _db.Entry(mark).State = EntityState.Detached;
            if (!await IsLowDayStoredAsync(userId, date)) throw;
        }
        return DayEditResult.Saved;
    }

    /// <summary>Removes the low-day mark from the user's local <paramref name="date"/>, if there is one.</summary>
    public async Task ClearLowDayAsync(ulong discordUserId, DateOnly date)
    {
        await _db.DayMarks
            .Where(m => m.UserId == (long)discordUserId && m.Date == date && m.Kind == DayMarkKind.LowDay)
            .ExecuteDeleteAsync();
    }

    /// <summary>All of the user's low days (local dates), for <see cref="ConsecutiveStreak"/>, <see cref="BestStreak"/> and <see cref="FlexibleStreak"/>.</summary>
    public async Task<HashSet<DateOnly>> GetLowDaysAsync(ulong discordUserId)
        => (await _db.DayMarks
            .Where(m => m.UserId == (long)discordUserId && m.Kind == DayMarkKind.LowDay)
            .Select(m => m.Date)
            .ToListAsync()).ToHashSet();

    private Task<bool> IsLowDayStoredAsync(long userId, DateOnly date)
        => _db.DayMarks.AnyAsync(m => m.UserId == userId && m.Date == date && m.Kind == DayMarkKind.LowDay);

    private async Task<(Habit? Habit, DayEditResult Result)> FindEditableHabitAsync(ulong discordUserId, int habitId, DateOnly date)
    {
        var habit = await _db.Habits
            .Include(h => h.User)
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == (long)discordUserId);

        if (habit is null) return (null, DayEditResult.HabitNotFound);
        if (date > TimezoneHelper.LocalToday(habit.User.Timezone, _time)) return (null, DayEditResult.InFuture);
        if (date < StartDate(habit, TimezoneHelper.Find(habit.User.Timezone) ?? TimeZoneInfo.Utc)) return (null, DayEditResult.BeforeHabitStart);
        return (habit, DayEditResult.Saved);
    }

    /// <summary>
    /// Returns how many of the last <paramref name="days"/> days were kept, using a rolling window ending on the
    /// user's local <paramref name="today"/>. A day is kept when it was completed or is one of the user's <paramref name="lowDays"/>.
    /// </summary>
    public static int FlexibleStreak(Habit habit, DateOnly today, int days = 7, IReadOnlySet<DateOnly>? lowDays = null)
    {
        var cutoff = today.AddDays(-(days - 1));
        var kept = habit.Logs.Where(l => l.Completed && l.Date >= cutoff).Select(l => l.Date).ToHashSet();
        if (lowDays is not null)
            kept.UnionWith(lowDays.Where(d => d >= cutoff && d <= today));
        return kept.Count;
    }

    /// <summary>
    /// How many local days stay open: today and yesterday. An open day that isn't done yet is pending,
    /// never missed; a day only counts as a gap once it has closed.
    /// </summary>
    public const int OpenDays = 2;

    /// <summary>Whether <paramref name="date"/> is still open (see <see cref="OpenDays"/>) on the user's local <paramref name="today"/>.</summary>
    public static bool IsOpen(DateOnly date, DateOnly today)
        => date <= today && date > today.AddDays(-OpenDays);

    /// <summary>
    /// Returns the current streak of completed days ending at the user's local <paramref name="today"/>,
    /// with up to <paramref name="graceDays"/> forgiven gaps, and how many grace days that streak used.
    /// Open days (<see cref="OpenDays"/>: today and yesterday) that aren't done yet are pending: they never
    /// break the streak and use no grace. Paused days, the user's <paramref name="lowDays"/> and an unlogged
    /// <see cref="TimezoneHelper.SwitchoverDate"/> are protected: they neither break nor extend the streak.
    /// Streaks are computed from the logs, never stored, so backfilling an older day heals the streak retroactively.
    /// </summary>
    public static (int streak, int graceUsed) ConsecutiveStreak(Habit habit, DateOnly today, int graceDays = 1,
        IReadOnlySet<DateOnly>? lowDays = null)
    {
        var completed = habit.Logs
            .Where(l => l.Completed)
            .Select(l => l.Date)
            .ToHashSet();

        if (completed.Count == 0) return (0, 0);

        // The earliest completed date — don't walk before it.
        var floor = completed.Min();

        int streak = 0;
        int graceUsed = 0;
        int graceRemaining = graceDays;

        var day = today;
        while (day >= floor)
        {
            if (IsCoveredOn(habit, day, completed, lowDays))
            {
                // Protected — skip without grace, but guard against underflow
                if (day == floor) break;
                day = day.AddDays(-1);
                continue;
            }

            if (completed.Contains(day))
            {
                streak++;
            }
            else if (IsOpen(day, today))
            {
            }
            else if (graceRemaining > 0)
            {
                graceRemaining--;
                graceUsed++;
            }
            else
            {
                break;
            }

            if (day == floor) break;
            day = day.AddDays(-1);
        }

        return (streak, graceUsed);
    }

    /// <summary>Returns whether the habit is paused on the given date.</summary>
    public static bool IsPausedOn(Habit habit, DateOnly date)
        => habit.PausedUntil.HasValue && date <= habit.PausedUntil.Value;

    private static bool IsCoveredOn(Habit habit, DateOnly date, HashSet<DateOnly> completed, IReadOnlySet<DateOnly>? lowDays)
        => IsPausedOn(habit, date) || lowDays?.Contains(date) == true
            || (date == TimezoneHelper.SwitchoverDate && !completed.Contains(date));

    /// <summary>Returns the longest consecutive completed-day streak (no grace).</summary>
    public static int BestStreak(Habit habit)
    {
        var dates = habit.Logs
            .Where(l => l.Completed)
            .Select(l => l.Date)
            .OrderBy(d => d)
            .ToList();

        int best = 0, current = 0;
        DateOnly? prev = null;
        foreach (var d in dates)
        {
            if (prev.HasValue && d == prev.Value.AddDays(1))
                current++;
            else
                current = 1;
            if (current > best) best = current;
            prev = d;
        }
        return best;
    }

    /// <summary>
    /// For weekly habits: returns (checkedInThisWeek, target) where the week
    /// is Monday–Sunday containing the user's local <paramref name="today"/>.
    /// </summary>
    public static (int done, int target) WeeklyProgress(Habit habit, DateOnly today)
    {
        var monday = WeekStart(today);
        var sunday = monday.AddDays(6);

        var done = habit.Logs.Count(l => l.Completed && l.Date >= monday && l.Date <= sunday);
        var target = habit.WeeklyTarget ?? 3;
        return (done, target);
    }

    /// <summary>Returns the Monday of the Monday–Sunday week containing <paramref name="day"/>.</summary>
    public static DateOnly WeekStart(DateOnly day)
        => day.AddDays(-(((int)day.DayOfWeek + 6) % 7));

    /// <summary>
    /// Returns whether the habit should be counted as active on the given date.
    /// A habit is only active on dates strictly after its creation date — the day
    /// it was created is excluded because the user had no full day to complete it.
    /// Pass the user's <paramref name="tz"/> to compare against the local creation day.
    /// </summary>
    public static bool IsActiveOn(Habit habit, DateOnly date, TimeZoneInfo? tz = null)
        => StartDate(habit, tz ?? TimeZoneInfo.Utc) < date;

    /// <summary>The habit's creation day in <paramref name="tz"/> (the user's current timezone): the first day that can be logged.</summary>
    public static DateOnly StartDate(Habit habit, TimeZoneInfo tz)
        => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(habit.CreatedAt, DateTimeKind.Utc), tz));

    public async Task<Habit?> SetFrequencyAsync(ulong discordUserId, int habitId, FrequencyType type, int? weeklyTarget)
    {
        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == (long)discordUserId);

        if (habit is null) return null;

        habit.FrequencyType = type;
        habit.WeeklyTarget  = type == FrequencyType.Weekly ? (weeklyTarget ?? 3) : null;
        await _db.SaveChangesAsync();
        return habit;
    }

    public async Task<bool> DeleteHabitAsync(ulong discordUserId, int habitId)
    {
        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == (long)discordUserId);

        if (habit is null) return false;

        _db.Habits.Remove(habit);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<Habit?> EditHabitAsync(ulong discordUserId, int habitId, string? newName, TimeOnly? newReminderTime, bool clearReminder)
    {
        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == (long)discordUserId);

        if (habit is null) return null;

        if (newName is not null) habit.Name = newName;

        if (clearReminder)
        {
            habit.ReminderTime = null;
            habit.NextReminderUtc = null;
        }
        else if (newReminderTime.HasValue)
        {
            habit.ReminderTime = newReminderTime;
            habit.NextReminderUtc = NextReminderUtc(habit, await GetUserTzAsync(discordUserId));
        }

        await _db.SaveChangesAsync();
        return habit;
    }

    /// <summary>Delays the habit's next reminder by <see cref="SnoozeDelay"/>. Returns false when the habit isn't the user's.</summary>
    public async Task<bool> SnoozeReminderAsync(ulong discordUserId, int habitId)
    {
        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == (long)discordUserId);

        if (habit is null) return false;

        habit.NextReminderUtc = _time.GetUtcNow().UtcDateTime + SnoozeDelay;
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>Recomputes every reminder of the user from their current timezone. Returns how many habits have a reminder.</summary>
    public async Task<int> RescheduleRemindersAsync(ulong discordUserId)
    {
        var tz = await GetUserTzAsync(discordUserId);
        var habits = await _db.Habits
            .Where(h => h.UserId == (long)discordUserId && h.ReminderTime != null)
            .ToListAsync();

        foreach (var habit in habits)
            habit.NextReminderUtc = NextReminderUtc(habit, tz);

        await _db.SaveChangesAsync();
        return habits.Count;
    }

    /// <summary>
    /// Marks the "your DM reminders are paused" notice as shown. Returns true only for the one
    /// call that should show it: the user's DM reminders are paused and they haven't been told yet.
    /// </summary>
    public async Task<bool> ClaimDmPauseNoticeAsync(ulong discordUserId)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        return await _db.Users
            .Where(u => u.DiscordUserId == (long)discordUserId && u.DmRemindersPausedAt != null && u.DmPauseNoticeSentAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.DmPauseNoticeSentAt, now)) == 1;
    }

    /// <summary>Permanently deletes the user; the database cascades to all their habits, logs and day marks (reminders live on the habits).</summary>
    public async Task DeleteUserDataAsync(ulong discordUserId)
    {
        await _db.Users
            .Where(u => u.DiscordUserId == (long)discordUserId)
            .ExecuteDeleteAsync();
    }

    /// <summary>Undoes <see cref="ClaimDmPauseNoticeAsync"/> when the notice couldn't be shown, so the next interaction shows it.</summary>
    public async Task ReleaseDmPauseNoticeAsync(ulong discordUserId)
    {
        await _db.Users
            .Where(u => u.DiscordUserId == (long)discordUserId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.DmPauseNoticeSentAt, (DateTime?)null));
    }

    /// <summary>Turns DM reminders back on after Ember could reach the user again.</summary>
    public async Task ResumeDmRemindersAsync(ulong discordUserId)
    {
        await _db.Users
            .Where(u => u.DiscordUserId == (long)discordUserId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.DmFailureCount, 0)
                .SetProperty(u => u.DmRemindersPausedAt, (DateTime?)null)
                .SetProperty(u => u.DmPauseNoticeSentAt, (DateTime?)null));
    }

    private DateTime? NextReminderUtc(Habit habit, TimeZoneInfo tz)
        => habit.ReminderTime is { } time
            ? TimezoneHelper.NextOccurrenceUtc(time, tz, _time.GetUtcNow().UtcDateTime)
            : null;

    public async Task<Habit?> PauseHabitAsync(ulong discordUserId, int habitId, DateOnly? pausedUntil)
    {
        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == (long)discordUserId);

        if (habit is null) return null;

        habit.PausedUntil = pausedUntil;
        await _db.SaveChangesAsync();
        return habit;
    }

    public async Task<int> GetGraceDaysAsync(ulong discordUserId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.DiscordUserId == (long)discordUserId);
        return user?.GraceDaysPerWeek ?? 1;
    }

    public async Task SetGraceDaysAsync(ulong discordUserId, int graceDays)
    {
        await EnsureUserAsync(discordUserId);
        var user = await _db.Users.FirstAsync(u => u.DiscordUserId == (long)discordUserId);
        user.GraceDaysPerWeek = graceDays;
        await _db.SaveChangesAsync();
    }

    /// <summary>Sets leaderboard visibility. Opting out never creates a user row for someone Ember has no data on.</summary>
    public async Task SetLeaderboardOptInAsync(ulong discordUserId, bool optIn)
    {
        if (!optIn && !await _db.Users.AnyAsync(u => u.DiscordUserId == (long)discordUserId)) return;
        await EnsureUserAsync(discordUserId);
        var user = await _db.Users.FirstAsync(u => u.DiscordUserId == (long)discordUserId);
        user.LeaderboardOptIn = optIn;
        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// Returns the top N opted-in users in a guild by completed check-ins over the
    /// rolling last 7 days. Users who have not opted in are never included.
    /// </summary>
    public async Task<List<(ulong UserId, int CheckIns)>> GetLeaderboardAsync(ulong guildId, int top = 10)
    {
        var weekAgo = DateOnly.FromDateTime(_time.GetUtcNow().UtcDateTime).AddDays(-6);
        var guildIdLong = (long)guildId;

        var rows = await _db.HabitLogs
            .Where(l => l.GuildId == guildIdLong && l.Completed && l.Date >= weekAgo && l.Habit.User.LeaderboardOptIn)
            .GroupBy(l => l.Habit.UserId)
            .Select(g => new { UserId = g.Key, CheckIns = g.Count() })
            .OrderByDescending(x => x.CheckIns)
            .Take(top)
            .ToListAsync();

        return rows.Select(r => ((ulong)r.UserId, r.CheckIns)).ToList();
    }

    public async Task<TimeZoneInfo> GetUserTzAsync(ulong discordUserId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.DiscordUserId == (long)discordUserId);
        return TimezoneHelper.Find(user?.Timezone ?? "UTC") ?? TimeZoneInfo.Utc;
    }

    /// <summary>The user's current local day (UTC when the user has no known timezone).</summary>
    public async Task<DateOnly> GetLocalTodayAsync(ulong discordUserId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.DiscordUserId == (long)discordUserId);
        return TimezoneHelper.LocalToday(user?.Timezone, _time);
    }

    public async Task<bool> HasTimezoneSetAsync(ulong discordUserId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.DiscordUserId == (long)discordUserId);
        return user?.Timezone is not null && user.Timezone != "UTC";
    }
}
