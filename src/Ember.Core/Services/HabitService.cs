using Ember.Core.Data;
using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;
using System.Globalization;

namespace Ember.Core.Services;

public partial class HabitService
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

    /// <summary>Whether the user agreed to the current health-data consent (<see cref="CurrentConsentPolicyVersion"/>).</summary>
    public async Task<bool> HasHealthDataConsentAsync(Guid userId)
        => await _db.Users.AnyAsync(u => u.Id == userId
            && u.HealthDataConsentAt != null && u.ConsentPolicyVersion == CurrentConsentPolicyVersion);

    /// <summary>Records the user's explicit consent (now, for <see cref="CurrentConsentPolicyVersion"/>).</summary>
    public async Task GiveHealthDataConsentAsync(Guid userId)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.HealthDataConsentAt, now)
                .SetProperty(u => u.ConsentPolicyVersion, CurrentConsentPolicyVersion));
    }

    /// <summary>
    /// For a user who already has habits but no current consent: marks today's consent prompt as shown and
    /// returns true, at most once per local day. Returns false for everyone else.
    /// </summary>
    public async Task<bool> ClaimConsentPromptAsync(Guid userId)
    {
        var today = await GetLocalTodayAsync(userId);
        return await _db.Users
            .Where(u => u.Id == userId && u.Habits.Any()
                && (u.HealthDataConsentAt == null || u.ConsentPolicyVersion != CurrentConsentPolicyVersion)
                && (u.ConsentPromptedOn == null || u.ConsentPromptedOn != today))
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.ConsentPromptedOn, today)) == 1;
    }

    /// <summary>Undoes <see cref="ClaimConsentPromptAsync"/> when the prompt couldn't be shown, so the next interaction asks again.</summary>
    public async Task ReleaseConsentPromptAsync(Guid userId)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.ConsentPromptedOn, (DateOnly?)null));
    }

    /// <summary>Notes that the consent prompt was shown today. Never creates a user.</summary>
    public async Task MarkConsentPromptedAsync(Guid userId)
    {
        var today = await GetLocalTodayAsync(userId);
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.ConsentPromptedOn, today));
    }

    /// <exception cref="ConsentRequiredException">The user hasn't agreed to the current health-data consent.</exception>
    /// <exception cref="HabitLimitReachedException">The user already tracks <see cref="MaxHabitsPerUser"/> habits.</exception>
    public async Task<Habit> AddHabitAsync(Guid userId, string name, TimeOnly? reminderTime,
        FrequencyType frequency = FrequencyType.Daily, int? weeklyTarget = null)
    {
        if (!await HasHealthDataConsentAsync(userId))
            throw new ConsentRequiredException();
        if (await _db.Habits.CountAsync(h => h.UserId == userId) >= MaxHabitsPerUser)
            throw new HabitLimitReachedException();

        var habit = new Habit
        {
            UserId = userId,
            Name = name,
            ReminderTime = reminderTime,
            FrequencyType = frequency,
            WeeklyTarget = frequency == FrequencyType.Weekly ? (weeklyTarget ?? 3) : null,
            CreatedAt = _time.GetUtcNow().UtcDateTime
        };
        habit.NextReminderUtc = NextReminderUtc(habit, await GetUserTzAsync(userId));
        _db.Habits.Add(habit);
        await _db.SaveChangesAsync();

        return habit;
    }

    public async Task<Habit?> GetHabitAsync(Guid userId, int habitId)
    {
        return await _db.Habits
            .Include(h => h.Logs)
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId);
    }

    public async Task<List<Habit>> GetHabitsAsync(Guid userId)
    {
        return await _db.Habits
            .Where(h => h.UserId == userId)
            .Include(h => h.Logs)
            .OrderBy(h => h.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Logs the habit as done or not done on the user's local <paramref name="date"/>, replacing any earlier log of that day.
    /// Any day from the habit's local start day (<see cref="StartDate"/>) to the user's local today can be logged,
    /// so past days can be backfilled or corrected; future days are refused.
    /// </summary>
    public async Task<DayEditResult> CheckInAsync(Guid userId, int habitId, DateOnly date, bool completed, ulong? guildId = null)
    {
        var (habit, result) = await FindEditableHabitAsync(userId, habitId, date);
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
    public async Task<DayEditResult> ClearDayAsync(Guid userId, int habitId, DateOnly date)
    {
        var (habit, result) = await FindEditableHabitAsync(userId, habitId, date);
        if (habit is null) return result;

        await _db.HabitLogs.Where(l => l.HabitId == habitId && l.Date == date).ExecuteDeleteAsync();
        return DayEditResult.Saved;
    }

    /// <summary>
    /// Marks the user's local <paramref name="date"/> as a low day for all their habits (see <see cref="ConsecutiveStreak"/>
    /// and <see cref="FlexibleStreak"/>). Any day up to the user's local today can be marked; marking it again is a no-op.
    /// Needs the health-data consent, since a low day can say something about the user's health.
    /// </summary>
    public async Task<DayEditResult> SetLowDayAsync(Guid userId, DateOnly date)
    {
        if (!await HasHealthDataConsentAsync(userId)) return DayEditResult.ConsentRequired;
        if (date > await GetLocalTodayAsync(userId)) return DayEditResult.InFuture;

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
    public async Task ClearLowDayAsync(Guid userId, DateOnly date)
    {
        await _db.DayMarks
            .Where(m => m.UserId == userId && m.Date == date && m.Kind == DayMarkKind.LowDay)
            .ExecuteDeleteAsync();
    }

    /// <summary>All of the user's low days (local dates), for <see cref="ConsecutiveStreak"/>, <see cref="BestStreak"/> and <see cref="FlexibleStreak"/>.</summary>
    public async Task<HashSet<DateOnly>> GetLowDaysAsync(Guid userId)
        => (await _db.DayMarks
            .Where(m => m.UserId == userId && m.Kind == DayMarkKind.LowDay)
            .Select(m => m.Date)
            .ToListAsync()).ToHashSet();

    /// <summary>
    /// Returns the habit's last <paramref name="days"/> local days, oldest first and ending at the user's local today,
    /// with each day's <see cref="DayState"/> and raw log. Null when the habit doesn't exist or isn't the user's.
    /// State precedence: before start, paused, low day, done, pending (open), not done.
    /// </summary>
    public async Task<IReadOnlyList<HabitDay>?> GetHabitDaysAsync(Guid userId, int habitId, int days)
    {
        var habit = await _db.Habits
            .Include(h => h.User)
            .Include(h => h.Logs)
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId);

        if (habit is null) return null;

        var tz = TimezoneHelper.Find(habit.User.Timezone) ?? TimeZoneInfo.Utc;
        var today = TimezoneHelper.LocalToday(habit.User.Timezone, _time);
        var start = StartDate(habit, tz);
        var lowDays = await GetLowDaysAsync(userId);
        var logs = habit.Logs.ToDictionary(l => l.Date, l => l.Completed);

        return Enumerable.Range(0, days)
            .Select(i => today.AddDays(i - days + 1))
            .Select(date =>
            {
                bool? completed = logs.TryGetValue(date, out var c) ? c : null;
                var state = date < start ? DayState.BeforeStart
                    : IsPausedOn(habit, date) ? DayState.Paused
                    : lowDays.Contains(date) ? DayState.LowDay
                    : completed == true ? DayState.Done
                    : IsOpen(date, today) ? DayState.Pending
                    : DayState.NotDone;
                return new HabitDay(date, state, completed);
            })
            .ToList();
    }

    private Task<bool> IsLowDayStoredAsync(Guid userId, DateOnly date)
        => _db.DayMarks.AnyAsync(m => m.UserId == userId && m.Date == date && m.Kind == DayMarkKind.LowDay);

    private async Task<(Habit? Habit, DayEditResult Result)> FindEditableHabitAsync(Guid userId, int habitId, DateOnly date)
    {
        var habit = await _db.Habits
            .Include(h => h.User)
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId);

        if (habit is null) return (null, DayEditResult.HabitNotFound);
        if (date > TimezoneHelper.LocalToday(habit.User.Timezone, _time)) return (null, DayEditResult.InFuture);
        if (date < StartDate(habit, TimezoneHelper.Find(habit.User.Timezone) ?? TimeZoneInfo.Utc)) return (null, DayEditResult.BeforeHabitStart);
        return (habit, DayEditResult.Saved);
    }

    /// <summary>
    /// Returns how many of the last <paramref name="days"/> days were kept, using a rolling window ending on the
    /// user's local <paramref name="today"/>. A day is kept when it was completed or is one of the user's <paramref name="lowDays"/>;
    /// low days only count from the habit's local start day (<see cref="StartDate"/> in <paramref name="tz"/>, UTC when omitted)
    /// and outside its paused range.
    /// </summary>
    public static int FlexibleStreak(Habit habit, DateOnly today, int days = 7, IReadOnlySet<DateOnly>? lowDays = null,
        TimeZoneInfo? tz = null)
    {
        var cutoff = today.AddDays(-(days - 1));
        var kept = habit.Logs.Where(l => l.Completed && l.Date >= cutoff).Select(l => l.Date).ToHashSet();
        if (lowDays is not null)
        {
            var start = StartDate(habit, tz ?? TimeZoneInfo.Utc);
            var from = start > cutoff ? start : cutoff;
            kept.UnionWith(lowDays.Where(d => d >= from && d <= today && !IsPausedOn(habit, d)));
        }
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
        var completed = CompletedDays(habit);
        return completed.Count == 0 ? (0, 0) : StreakEndingAt(habit, today, today, graceDays, lowDays, completed);
    }

    /// <summary>Returns whether the habit is paused on the given date: inside [<see cref="Habit.PausedFrom"/>, <see cref="Habit.PausedUntil"/>].</summary>
    public static bool IsPausedOn(Habit habit, DateOnly date)
        => habit.PausedUntil.HasValue && date <= habit.PausedUntil.Value
            && (habit.PausedFrom is null || date >= habit.PausedFrom.Value);

    private static bool IsCoveredOn(Habit habit, DateOnly date, HashSet<DateOnly> completed, IReadOnlySet<DateOnly>? lowDays)
        => IsPausedOn(habit, date) || lowDays?.Contains(date) == true
            || (date == TimezoneHelper.SwitchoverDate && !completed.Contains(date));

    /// <summary>
    /// Returns the longest streak the habit ever had, by the same rules as <see cref="ConsecutiveStreak"/>:
    /// grace days per rolling 7-day window, open days, low days, pauses and the switchover date. Never below the current streak.
    /// </summary>
    public static int BestStreak(Habit habit, DateOnly today, int graceDays = 1, IReadOnlySet<DateOnly>? lowDays = null)
    {
        var completed = CompletedDays(habit);
        return completed
            .Where(d => d == today || (d < today && !completed.Contains(d.AddDays(1))))
            .Select(end => StreakEndingAt(habit, end, today, graceDays, lowDays, completed).streak)
            .DefaultIfEmpty(0)
            .Max();
    }

    private static HashSet<DateOnly> CompletedDays(Habit habit)
        => habit.Logs.Where(l => l.Completed).Select(l => l.Date).ToHashSet();

    /// <summary>
    /// Walks back from <paramref name="end"/> to the earliest completed day. A closed gap is forgiven only while no
    /// 7-day window would hold more than <paramref name="graceDays"/> forgiven gaps; the first gap that can't be forgiven ends the streak.
    /// </summary>
    private static (int streak, int graceUsed) StreakEndingAt(Habit habit, DateOnly end, DateOnly today, int graceDays,
        IReadOnlySet<DateOnly>? lowDays, HashSet<DateOnly> completed)
    {
        var floor = completed.Min();
        var streak = 0;
        var forgiven = new List<DateOnly>();

        for (var day = end; day >= floor; day = day.AddDays(-1))
        {
            if (IsCoveredOn(habit, day, completed, lowDays) || (IsOpen(day, today) && !completed.Contains(day)))
                continue;

            if (completed.Contains(day))
                streak++;
            else if (forgiven.Count(g => g.DayNumber - day.DayNumber < 7) < graceDays)
                forgiven.Add(day);
            else
                break;
        }

        return (streak, forgiven.Count);
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

    public async Task<Habit?> SetFrequencyAsync(Guid userId, int habitId, FrequencyType type, int? weeklyTarget)
    {
        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId);

        if (habit is null) return null;

        habit.FrequencyType = type;
        habit.WeeklyTarget  = type == FrequencyType.Weekly ? (weeklyTarget ?? 3) : null;
        await _db.SaveChangesAsync();
        return habit;
    }

    public async Task<bool> DeleteHabitAsync(Guid userId, int habitId)
    {
        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId);

        if (habit is null) return false;

        _db.Habits.Remove(habit);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<Habit?> EditHabitAsync(Guid userId, int habitId, string? newName, TimeOnly? newReminderTime, bool clearReminder)
    {
        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId);

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
            habit.NextReminderUtc = NextReminderUtc(habit, await GetUserTzAsync(userId));
        }

        await _db.SaveChangesAsync();
        return habit;
    }

    /// <summary>How long a reminder's snooze button stays usable after the reminder was sent.</summary>
    public static readonly TimeSpan SnoozeWindow = TimeSpan.FromHours(24);

    /// <summary>
    /// Delays the habit's next reminder by <see cref="SnoozeDelay"/>. Returns false when the habit isn't the user's or has no reminder,
    /// or when the reminder was sent (<paramref name="sentAtUtc"/>) more than <see cref="SnoozeWindow"/> ago, so an old DM can't displace the schedule.
    /// </summary>
    public async Task<bool> SnoozeReminderAsync(Guid userId, int habitId, DateTimeOffset sentAtUtc)
    {
        if (_time.GetUtcNow() - sentAtUtc > SnoozeWindow) return false;

        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId && h.ReminderTime != null);

        if (habit is null) return false;

        habit.NextReminderUtc = _time.GetUtcNow().UtcDateTime + SnoozeDelay;
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>Recomputes every reminder of the user from their current timezone. Returns how many habits have a reminder.</summary>
    public async Task<int> RescheduleRemindersAsync(Guid userId)
    {
        var tz = await GetUserTzAsync(userId);
        var habits = await _db.Habits
            .Where(h => h.UserId == userId && h.ReminderTime != null)
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
    public async Task<bool> ClaimDmPauseNoticeAsync(Guid userId)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        return await _db.Users
            .Where(u => u.Id == userId && u.DmRemindersPausedAt != null && u.DmPauseNoticeSentAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.DmPauseNoticeSentAt, now)) == 1;
    }

    /// <summary>Permanently deletes the user; the database cascades to all their habits, logs and day marks (reminders live on the habits).</summary>
    public async Task DeleteUserDataAsync(Guid userId)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteDeleteAsync();
    }

    /// <summary>Undoes <see cref="ClaimDmPauseNoticeAsync"/> when the notice couldn't be shown, so the next interaction shows it.</summary>
    public async Task ReleaseDmPauseNoticeAsync(Guid userId)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.DmPauseNoticeSentAt, (DateTime?)null));
    }

    /// <summary>Turns DM reminders back on after Ember could reach the user again.</summary>
    public async Task ResumeDmRemindersAsync(Guid userId)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.DmFailureCount, 0)
                .SetProperty(u => u.DmRemindersPausedAt, (DateTime?)null)
                .SetProperty(u => u.DmPauseNoticeSentAt, (DateTime?)null));
    }

    private DateTime? NextReminderUtc(Habit habit, TimeZoneInfo tz)
        => habit.ReminderTime is { } time
            ? TimezoneHelper.NextOccurrenceUtc(time, tz, _time.GetUtcNow().UtcDateTime)
            : null;

    /// <summary>
    /// Pauses the habit through the local day <paramref name="pausedUntil"/>, or resumes it when null.
    /// A new pause starts today; extending a running pause keeps its start. Resuming ends the pause yesterday,
    /// so the days already paused stay protected; a pause that started today is removed entirely.
    /// </summary>
    public async Task<Habit?> PauseHabitAsync(Guid userId, int habitId, DateOnly? pausedUntil)
    {
        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId);

        if (habit is null) return null;

        var today = await GetLocalTodayAsync(userId);
        if (pausedUntil is not null)
        {
            if (!IsPausedOn(habit, today)) habit.PausedFrom = today;
            habit.PausedUntil = pausedUntil;
        }
        else if (habit.PausedUntil is { } until && (habit.PausedFrom is null || habit.PausedFrom < today))
        {
            habit.PausedUntil = until < today ? until : today.AddDays(-1);
        }
        else
        {
            habit.PausedFrom = null;
            habit.PausedUntil = null;
        }

        await _db.SaveChangesAsync();
        return habit;
    }

    public async Task<int> GetGraceDaysAsync(Guid userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        return user?.GraceDaysPerWeek ?? 1;
    }

    public async Task SetGraceDaysAsync(Guid userId, int graceDays)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.GraceDaysPerWeek, graceDays));
    }

    public async Task SetLeaderboardOptInAsync(Guid userId, bool optIn)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.LeaderboardOptIn, optIn));
    }

    /// <summary>
    /// Returns the top N opted-in users in a guild by completed check-ins over the
    /// rolling last 7 days. Users who have not opted in are never included.
    /// </summary>
    public async Task<List<(ulong DiscordUserId, int CheckIns)>> GetLeaderboardAsync(ulong guildId, int top = 10)
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

        // A guild check-in always comes from Discord, so every ranked user has a Discord login.
        var userIds = rows.Select(r => r.UserId).ToList();
        var discordIds = await _db.UserLogins
            .Where(l => l.LoginProvider == DiscordLogin.Provider && userIds.Contains(l.UserId))
            .ToDictionaryAsync(l => l.UserId, l => ulong.Parse(l.ProviderKey, CultureInfo.InvariantCulture));

        return rows.Where(r => discordIds.ContainsKey(r.UserId))
            .Select(r => (discordIds[r.UserId], r.CheckIns)).ToList();
    }

    public async Task<TimeZoneInfo> GetUserTzAsync(Guid userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        return TimezoneHelper.Find(user?.Timezone ?? "UTC") ?? TimeZoneInfo.Utc;
    }

    /// <summary>The user's current local day (UTC when the user has no known timezone).</summary>
    public async Task<DateOnly> GetLocalTodayAsync(Guid userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        return TimezoneHelper.LocalToday(user?.Timezone, _time);
    }

    public async Task<bool> HasTimezoneSetAsync(Guid userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        return user?.Timezone is not null && user.Timezone != "UTC";
    }

    /// <summary>Stores the user's timezone id. Does not reschedule reminders.</summary>
    public async Task SetTimezoneAsync(Guid userId, string timezoneId)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.Timezone, timezoneId));
    }

    /// <summary>The user with every habit, log and day mark (untracked), or null when Ember stores nothing about them.</summary>
    public Task<User?> GetUserForExportAsync(Guid userId)
        => _db.Users
            .AsNoTracking()
            .Include(u => u.Habits).ThenInclude(h => h.Logs)
            .Include(u => u.DayMarks)
            .AsSplitQuery()
            .FirstOrDefaultAsync(u => u.Id == userId);

    /// <summary>Total number of habits across all users.</summary>
    public Task<int> CountHabitsAsync() => _db.Habits.CountAsync();

    public Task<bool> UserExistsAsync(Guid userId, CancellationToken cancellationToken = default)
        => _db.Users.AnyAsync(u => u.Id == userId, cancellationToken);

    /// <summary>Id and timezone of every user with at least one habit.</summary>
    public async Task<List<(Guid UserId, string Timezone)>> GetUserTimezonesWithHabitsAsync(CancellationToken cancellationToken = default)
    {
        var rows = await _db.Users
            .Where(u => u.Habits.Any())
            .Select(u => new { u.Id, u.Timezone })
            .ToListAsync(cancellationToken);
        return rows.Select(r => (r.Id, r.Timezone)).ToList();
    }

    /// <summary>The given users (tracked) with their logins, habits, logs and day marks.</summary>
    public Task<List<User>> GetUsersWithHabitsAsync(List<Guid> userIds, CancellationToken cancellationToken = default)
        => _db.Users
            .Include(u => u.Logins)
            .Include(u => u.Habits)
                .ThenInclude(h => h.Logs)
            .Include(u => u.DayMarks)
            .AsSplitQuery()
            .Where(u => userIds.Contains(u.Id))
            .ToListAsync(cancellationToken);

    /// <summary>Ids of habits whose next reminder is due at or before <paramref name="nowUtc"/>.</summary>
    public Task<List<int>> GetDueReminderHabitIdsAsync(DateTime nowUtc, CancellationToken cancellationToken = default)
        => _db.Habits
            .Where(h => h.NextReminderUtc != null && h.NextReminderUtc <= nowUtc)
            .Select(h => h.Id)
            .ToListAsync(cancellationToken);

    /// <summary>The habit (tracked) with its user and the user's logins, regardless of owner. Persist edits with <see cref="SaveChangesAsync"/>.</summary>
    public Task<Habit?> GetHabitWithUserAsync(int habitId, CancellationToken cancellationToken = default)
        => _db.Habits.Include(h => h.User).ThenInclude(u => u.Logins).FirstOrDefaultAsync(h => h.Id == habitId, cancellationToken);

    public Task<bool> IsCompletedOnAsync(int habitId, DateOnly date, CancellationToken cancellationToken = default)
        => _db.HabitLogs.AnyAsync(l => l.HabitId == habitId && l.Date == date && l.Completed, cancellationToken);

    /// <summary>Completed logs of the habit dated strictly between <paramref name="after"/> and <paramref name="before"/>.</summary>
    public Task<int> CountCompletedBetweenAsync(int habitId, DateOnly after, DateOnly before, CancellationToken cancellationToken = default)
        => _db.HabitLogs.CountAsync(l => l.HabitId == habitId && l.Date > after && l.Date < before && l.Completed, cancellationToken);

    /// <summary>Saves pending changes to entities loaded through this service.</summary>
    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => _db.SaveChangesAsync(cancellationToken);

    /// <summary>Sets the habit's next reminder to <paramref name="untilUtc"/> directly in the database.</summary>
    public Task DeferReminderAsync(int habitId, DateTime untilUtc, CancellationToken cancellationToken = default)
        => _db.Habits
            .Where(h => h.Id == habitId)
            .ExecuteUpdateAsync(s => s.SetProperty(h => h.NextReminderUtc, untilUtc), cancellationToken);
}
