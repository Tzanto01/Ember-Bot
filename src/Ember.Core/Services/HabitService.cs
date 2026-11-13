using Ember.Core.Data;
using Ember.Core.Localization;
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
    public const string CurrentConsentPolicyVersion = "2026-11";

    /// <summary>Days after a "No thanks" before Ember asks for consent again on its own.</summary>
    public const int ConsentDeclineBackoffDays = 30;

    /// <summary>Most check-ins a daily or weekdays habit can need per day (<see cref="Habit.TimesPerDay"/>).</summary>
    public const int MaxTimesPerDay = 10;

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
    /// returns true, at most once per local day and not within <see cref="ConsentDeclineBackoffDays"/> of a decline.
    /// Returns false for everyone else.
    /// </summary>
    public async Task<bool> ClaimConsentPromptAsync(Guid userId)
    {
        var today = await GetLocalTodayAsync(userId);
        return await _db.Users
            .Where(u => u.Id == userId && u.Habits.Any()
                && (u.HealthDataConsentAt == null || u.ConsentPolicyVersion != CurrentConsentPolicyVersion)
                && (u.ConsentPromptedOn == null || u.ConsentPromptedOn < today))
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.ConsentPromptedOn, today)) == 1;
    }

    /// <summary>Undoes <see cref="ClaimConsentPromptAsync"/> when the prompt couldn't be shown, so the next interaction asks again.</summary>
    public async Task ReleaseConsentPromptAsync(Guid userId)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.ConsentPromptedOn, (DateOnly?)null));
    }

    /// <summary>
    /// Notes a "No thanks" to the consent prompt, so <see cref="ClaimConsentPromptAsync"/> waits <see cref="ConsentDeclineBackoffDays"/>
    /// before asking again. Never creates a user.
    /// </summary>
    public async Task DeclineConsentPromptAsync(Guid userId)
    {
        var lastQuietDay = (await GetLocalTodayAsync(userId)).AddDays(ConsentDeclineBackoffDays - 1);
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.ConsentPromptedOn, lastQuietDay));
    }

    /// <summary>Notes that the consent prompt was shown today, keeping a later decline back-off. Never creates a user.</summary>
    public async Task MarkConsentPromptedAsync(Guid userId)
    {
        var today = await GetLocalTodayAsync(userId);
        await _db.Users
            .Where(u => u.Id == userId && (u.ConsentPromptedOn == null || u.ConsentPromptedOn < today))
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.ConsentPromptedOn, today));
    }

    /// <exception cref="ConsentRequiredException">The user hasn't agreed to the current health-data consent.</exception>
    /// <exception cref="HabitLimitReachedException">The user already tracks <see cref="MaxHabitsPerUser"/> habits.</exception>
    /// <remarks>
    /// <paramref name="days"/> is stored for <see cref="FrequencyType.Weekdays"/> habits only; weekly habits always get <paramref name="timesPerDay"/> 1.
    /// <paramref name="reminderTimes"/>, when given, replaces <paramref name="reminderTime"/> and is kept as <see cref="NormalizeReminderTimes"/> does.
    /// </remarks>
    public async Task<Habit> AddHabitAsync(Guid userId, string name, TimeOnly? reminderTime,
        FrequencyType frequency = FrequencyType.Daily, int? weeklyTarget = null, IReadOnlyCollection<string>? reminderExclusions = null,
        ScheduleDays? days = null, int timesPerDay = 1, IReadOnlyCollection<TimeOnly>? reminderTimes = null)
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
            Days = frequency == FrequencyType.Weekdays ? days : null,
            TimesPerDay = frequency == FrequencyType.Weekly ? 1 : timesPerDay,
            ReminderExclusions = reminderExclusions?.Distinct().ToList() ?? [],
            CreatedAt = _time.GetUtcNow().UtcDateTime
        };
        if (reminderTimes is not null) habit.ReminderTimes = NormalizeReminderTimes(reminderTimes, habit.TimesPerDay);
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
    /// Logs the habit as done (<see cref="HabitLog.Count"/> = <see cref="Habit.TimesPerDay"/>) or explicitly not done (count 0)
    /// on the user's local <paramref name="date"/>, replacing any earlier log of that day.
    /// Any day from the habit's local start day (<see cref="StartDate"/>) to the user's local today can be logged,
    /// so past days can be backfilled or corrected; future days are refused.
    /// </summary>
    public Task<DayEditResult> CheckInAsync(Guid userId, int habitId, DateOnly date, bool completed, ulong? guildId = null)
        => WriteCountAsync(userId, habitId, date, guildId, (habit, _) => completed ? habit.TimesPerDay : 0);

    /// <summary>
    /// Sets the day's check-in count to the absolute <paramref name="count"/> (0 to <see cref="Habit.TimesPerDay"/>),
    /// by the same day rules as <see cref="CheckInAsync"/>. The day is done once the count reaches the habit's target.
    /// </summary>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="count"/> is outside 0 to the habit's <see cref="Habit.TimesPerDay"/>; nothing is written.</exception>
    public Task<DayEditResult> SetCountAsync(Guid userId, int habitId, DateOnly date, int count, ulong? guildId = null)
        => WriteCountAsync(userId, habitId, date, guildId, (habit, _) => count >= 0 && count <= habit.TimesPerDay
            ? count
            : throw new ArgumentOutOfRangeException(nameof(count), count, $"Must be between 0 and {habit.TimesPerDay}."));

    /// <summary>Adds one check-in to the day, capped at the habit's <see cref="Habit.TimesPerDay"/>, by the same day rules as <see cref="CheckInAsync"/>.</summary>
    public Task<DayEditResult> AddCheckInAsync(Guid userId, int habitId, DateOnly date, ulong? guildId = null)
        => WriteCountAsync(userId, habitId, date, guildId, (habit, current) => Math.Min(current + 1, habit.TimesPerDay));

    private async Task<DayEditResult> WriteCountAsync(Guid userId, int habitId, DateOnly date, ulong? guildId, Func<Habit, int, int> nextCount)
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
                GuildId = guildId.HasValue ? (long)guildId.Value : null
            };
            ApplyCount(log, nextCount(habit, 0), habit);
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

        ApplyCount(existing, nextCount(habit, existing.Count), habit);
        if (guildId.HasValue) existing.GuildId = (long)guildId.Value;
        await _db.SaveChangesAsync();
        return DayEditResult.Saved;
    }

    private static void ApplyCount(HabitLog log, int count, Habit habit)
    {
        log.Completed = count >= habit.TimesPerDay || (log.Completed && count > 0 && count >= log.Count);
        log.Count = count;
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

    /// <summary>The local start day (<see cref="StartDate"/>) of the user's oldest habit, or null when they have none. Loads no logs.</summary>
    public async Task<DateOnly?> GetEarliestHabitStartAsync(Guid userId)
    {
        var oldest = await _db.Habits
            .Where(h => h.UserId == userId)
            .OrderBy(h => h.CreatedAt)
            .FirstOrDefaultAsync();
        return oldest is null ? (DateOnly?)null : StartDate(oldest, await GetUserTzAsync(userId));
    }

    /// <summary>
    /// Returns the habit's last <paramref name="days"/> local days, oldest first and ending at the user's local today,
    /// with each day's <see cref="DayState"/> and raw log. Null when the habit doesn't exist or isn't the user's.
    /// State precedence: before start, paused, low day, done, partial, offday, pending (open), not done.
    /// </summary>
    public async Task<IReadOnlyList<HabitDay>?> GetHabitDaysAsync(Guid userId, int habitId, int days)
    {
        var today = await GetLocalTodayAsync(userId);
        return await GetHabitDaysAsync(userId, habitId, today.AddDays(1 - days), today);
    }

    /// <summary>
    /// Returns the habit's local days from <paramref name="from"/> through <paramref name="to"/>, oldest first (empty when
    /// <paramref name="from"/> is after <paramref name="to"/>), by the rules of <see cref="DayOn"/>.
    /// Null when the habit doesn't exist or isn't the user's.
    /// </summary>
    public async Task<IReadOnlyList<HabitDay>?> GetHabitDaysAsync(Guid userId, int habitId, DateOnly from, DateOnly to)
    {
        var habit = await _db.Habits
            .Include(h => h.User)
            .Include(h => h.Logs.Where(l => l.Date >= from && l.Date <= to))
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId);

        if (habit is null) return null;

        var tz = TimezoneHelper.Find(habit.User.Timezone) ?? TimeZoneInfo.Utc;
        var today = TimezoneHelper.LocalToday(habit.User.Timezone, _time);
        var lowDays = await GetLowDaysAsync(userId);

        var result = new List<HabitDay>();
        for (var date = from; date <= to; date = date.AddDays(1))
            result.Add(DayOn(habit, date, today, tz, lowDays));
        return result;
    }

    /// <summary>
    /// The habit's <see cref="DayState"/> and raw log on the user's local <paramref name="date"/>, given the user's local
    /// <paramref name="today"/>, timezone and low days. Needs the habit's log of that date loaded, if there is one.
    /// State precedence: before start, paused, low day, done, partial (some check-ins, not done), offday (not
    /// <see cref="IsScheduledOn"/>), pending (open), not done.
    /// </summary>
    public static HabitDay DayOn(Habit habit, DateOnly date, DateOnly today, TimeZoneInfo tz, IReadOnlySet<DateOnly> lowDays)
    {
        var log = habit.Logs.FirstOrDefault(l => l.Date == date);
        var partial = log is { Completed: false, Count: > 0 };
        var state = date < StartDate(habit, tz) ? DayState.BeforeStart
            : IsPausedOn(habit, date) ? DayState.Paused
            : lowDays.Contains(date) ? DayState.LowDay
            : log?.Completed == true ? DayState.Done
            : partial ? DayState.Partial
            : !IsScheduledOn(habit, date) ? DayState.Offday
            : IsOpen(date, today) ? DayState.Pending
            : DayState.NotDone;
        return new HabitDay(date, state, partial ? null : log?.Completed, log?.Count ?? 0);
    }

    /// <summary>
    /// Per local day from <paramref name="from"/> through <paramref name="to"/> (oldest first), across all the user's habits,
    /// by the rules of <see cref="DayStatsOn"/>. Empty when <paramref name="from"/> is after <paramref name="to"/>.
    /// </summary>
    public async Task<IReadOnlyList<DayStats>> GetDayStatsAsync(Guid userId, DateOnly from, DateOnly to)
    {
        var tz = await GetUserTzAsync(userId);
        var habits = await _db.Habits
            .AsNoTracking()
            .Where(h => h.UserId == userId)
            .Include(h => h.Logs.Where(l => l.Date >= from && l.Date <= to))
            .ToListAsync();

        var result = new List<DayStats>();
        for (var date = from; date <= to; date = date.AddDays(1))
            result.Add(DayStatsOn(habits, date, tz));
        return result;
    }

    /// <summary>
    /// One local day across <paramref name="habits"/> (with that day's logs loaded): <c>Scheduled</c> counts the habits expected
    /// that day (from their <see cref="StartDate"/>, not paused, <see cref="IsScheduledOn"/>; low days don't change it, and a weekly
    /// habit counts only on a day it has a check-in, since any day can serve its target), <c>Done</c> and <c>Partial</c> the habits
    /// whose log reached each state (offdays included),
    /// and <c>ShowedUp</c> is true when any habit has a check-in that day.
    /// </summary>
    public static DayStats DayStatsOn(IEnumerable<Habit> habits, DateOnly date, TimeZoneInfo tz)
    {
        int scheduled = 0, done = 0, partial = 0;
        var showedUp = false;
        foreach (var habit in habits)
        {
            var log = habit.Logs.FirstOrDefault(l => l.Date == date);
            if (date >= StartDate(habit, tz) && !IsPausedOn(habit, date) && IsScheduledOn(habit, date)
                && (habit.FrequencyType != FrequencyType.Weekly || log is { Completed: true } or { Count: > 0 }))
                scheduled++;
            if (log is null) continue;
            if (log.Completed) done++;
            else if (log.Count > 0) partial++;
            showedUp |= log.Completed || log.Count > 0;
        }
        return new DayStats(date, scheduled, done, partial, showedUp);
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
    /// user's local <paramref name="today"/>. A day is kept when it was completed (offdays included) or is one of the user's
    /// <paramref name="lowDays"/>; low days only count from the habit's local start day (<see cref="StartDate"/> in
    /// <paramref name="tz"/>, UTC when omitted), outside its paused range and on scheduled days (<see cref="IsScheduledOn"/>).
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
            kept.UnionWith(lowDays.Where(d => d >= from && d <= today && !IsPausedOn(habit, d) && IsScheduledOn(habit, d)));
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
    /// <see cref="TimezoneHelper.SwitchoverDate"/> are protected: they neither break nor extend the streak. So is an offday
    /// (not <see cref="IsScheduledOn"/>) that isn't done, so grace only ever covers scheduled days; a done offday extends it.
    /// A partial day counts as not done. Streaks are computed from the logs, never stored, so backfilling an older day heals the streak retroactively.
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

    /// <summary>Returns whether the habit is scheduled on the given date: always, unless it is a <see cref="FrequencyType.Weekdays"/> habit and the date's weekday isn't in <see cref="Habit.Days"/>.</summary>
    public static bool IsScheduledOn(Habit habit, DateOnly date)
        => habit.FrequencyType != FrequencyType.Weekdays
            || (habit.Days.GetValueOrDefault() & (ScheduleDays)(1 << (((int)date.DayOfWeek + 6) % 7))) != 0;

    private static bool IsCoveredOn(Habit habit, DateOnly date, HashSet<DateOnly> completed, IReadOnlySet<DateOnly>? lowDays)
        => IsPausedOn(habit, date) || lowDays?.Contains(date) == true
            || (!completed.Contains(date) && (date == TimezoneHelper.SwitchoverDate || !IsScheduledOn(habit, date)));

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

    /// <summary>
    /// The habit's stats on the user's local <paramref name="today"/>: <see cref="FlexibleStreak"/> over the last 7 days, plus
    /// <see cref="WeeklyProgress"/> for weekly habits, or <see cref="ConsecutiveStreak"/> and <see cref="BestStreak"/> for the others.
    /// </summary>
    public static HabitStats StatsOn(Habit habit, DateOnly today, int graceDays, IReadOnlySet<DateOnly> lowDays, TimeZoneInfo tz)
    {
        var last7 = FlexibleStreak(habit, today, 7, lowDays, tz);
        if (habit.FrequencyType == FrequencyType.Weekly)
            return new HabitStats(null, null, null, last7, WeeklyProgress(habit, today));

        var (streak, graceUsed) = ConsecutiveStreak(habit, today, graceDays, lowDays);
        return new HabitStats(streak, graceUsed, BestStreak(habit, today, graceDays, lowDays), last7, null);
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

    /// <summary>
    /// Sets the habit's schedule: <paramref name="weeklyTarget"/> (default 3) is kept for weekly habits only, <paramref name="days"/>
    /// for <see cref="FrequencyType.Weekdays"/> habits only, and weekly habits always get <paramref name="timesPerDay"/> 1.
    /// A day that was done stays done: when the target per day changes, days whose count reaches the new target become done, counts
    /// above a lowered target are clamped to it, and only the user's local today is recomputed against it. Reminder times beyond the
    /// new target are dropped, keeping the earliest. Null when the habit isn't the user's.
    /// </summary>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="timesPerDay"/> is outside 1 to <see cref="MaxTimesPerDay"/>.</exception>
    /// <exception cref="ArgumentException">A weekdays habit without any <paramref name="days"/>.</exception>
    public async Task<Habit?> SetScheduleAsync(Guid userId, int habitId, FrequencyType type, int? weeklyTarget, ScheduleDays? days,
        int timesPerDay)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(timesPerDay, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(timesPerDay, MaxTimesPerDay);
        if (type == FrequencyType.Weekdays && days.GetValueOrDefault() == ScheduleDays.None)
            throw new ArgumentException("A weekdays habit needs at least one day.", nameof(days));

        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId);

        if (habit is null) return null;

        var target = type == FrequencyType.Weekly ? 1 : timesPerDay;
        var recompute = target != habit.TimesPerDay;
        habit.FrequencyType = type;
        habit.WeeklyTarget = type == FrequencyType.Weekly ? (weeklyTarget ?? 3) : null;
        habit.Days = type == FrequencyType.Weekdays ? days : null;
        habit.TimesPerDay = target;
        if (habit.ReminderTimes.Count > target)
        {
            habit.ReminderTimes = habit.ReminderTimes.Take(target).ToList();
            habit.NextReminderUtc = NextReminderUtc(habit, await GetUserTzAsync(userId));
        }

        await using var transaction = await _db.Database.BeginTransactionAsync();
        await _db.SaveChangesAsync();
        if (recompute)
        {
            var today = await GetLocalTodayAsync(userId);
            await _db.HabitLogs
                .Where(l => l.HabitId == habitId && (l.Date == today || l.Count >= target))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(l => l.Completed, l => l.Count >= target)
                    .SetProperty(l => l.Count, l => l.Count > target ? target : l.Count));
        }
        await transaction.CommitAsync();
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

    /// <summary>
    /// Edits the user's habit; null arguments keep the current value. <paramref name="newReminderTime"/> replaces all reminder times
    /// with that one; <paramref name="newReminderTimes"/> replaces them with those (empty clears the reminder), kept as
    /// <see cref="NormalizeReminderTimes"/> does. <paramref name="reminderExclusions"/> replaces <see cref="Habit.ReminderExclusions"/>.
    /// Null when the habit isn't the user's.
    /// </summary>
    public async Task<Habit?> EditHabitAsync(Guid userId, int habitId, string? newName, TimeOnly? newReminderTime, bool clearReminder,
        IReadOnlyCollection<string>? reminderExclusions = null, IReadOnlyCollection<TimeOnly>? newReminderTimes = null)
    {
        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId);

        if (habit is null) return null;

        if (newName is not null) habit.Name = newName;
        if (reminderExclusions is not null) habit.ReminderExclusions = reminderExclusions.Distinct().ToList();

        if (clearReminder)
        {
            habit.ReminderTime = null;
            habit.NextReminderUtc = null;
        }
        else if (newReminderTimes is not null)
        {
            habit.ReminderTimes = NormalizeReminderTimes(newReminderTimes, habit.TimesPerDay);
            habit.NextReminderUtc = NextReminderUtc(habit, await GetUserTzAsync(userId));
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
    /// Delays the habit's next reminder by <see cref="SnoozeDelay"/> and drops its pending second reminder. Returns false when the habit isn't the user's or has no reminder,
    /// when the reminder was sent (<paramref name="sentAtUtc"/>) more than <see cref="SnoozeWindow"/> ago, so an old DM can't displace the schedule,
    /// or when the snoozed reminder would land on a later local day than the one the reminder was sent on.
    /// </summary>
    public async Task<bool> SnoozeReminderAsync(Guid userId, int habitId, DateTimeOffset sentAtUtc)
    {
        if (_time.GetUtcNow() - sentAtUtc > SnoozeWindow) return false;

        var tz = await GetUserTzAsync(userId);
        if (DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(_time.GetUtcNow() + SnoozeDelay, tz).DateTime)
            != DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(sentAtUtc, tz).DateTime))
            return false;

        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == userId && h.ReminderTimes.Count > 0);

        if (habit is null) return false;

        habit.NextReminderUtc = _time.GetUtcNow().UtcDateTime + SnoozeDelay;
        habit.SecondReminderUtc = null;
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>Recomputes every habit and routine reminder of the user from their current timezone. Returns how many habits have a reminder.</summary>
    public async Task<int> RescheduleRemindersAsync(Guid userId)
    {
        var tz = await GetUserTzAsync(userId);
        var habits = await _db.Habits
            .Where(h => h.UserId == userId && h.ReminderTimes.Count > 0)
            .ToListAsync();

        foreach (var habit in habits)
            habit.NextReminderUtc = NextReminderUtc(habit, tz);
        foreach (var routine in await _db.Routines.Where(r => r.UserId == userId && r.ReminderTime != null).ToListAsync())
            routine.NextReminderUtc = NextReminderUtc(routine, tz);

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

    /// <summary>Permanently deletes the user; the database cascades to all their habits, logs, day marks, routines, journal entries, own moods and journal key (reminders live on the habits and routines).</summary>
    public async Task DeleteUserDataAsync(Guid userId)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteDeleteAsync();
    }

    /// <summary>How long an email signup may stay unconfirmed before <see cref="DeleteStaleUnconfirmedAccountsAsync"/> removes it.</summary>
    public static readonly TimeSpan UnconfirmedAccountLifetime = TimeSpan.FromDays(7);

    /// <summary>
    /// Permanently deletes email signups older than <see cref="UnconfirmedAccountLifetime"/> whose email was never confirmed and that
    /// hold nothing a user made: no Discord or other external login, habits, routines, day marks, notes, moods, push subscriptions
    /// or journal key. The creation time is read from the account's UUIDv7 ID; an account with any other ID version is kept.
    /// Returns how many accounts were deleted.
    /// </summary>
    public async Task<int> DeleteStaleUnconfirmedAccountsAsync(CancellationToken cancellationToken = default)
    {
        var deletable = _db.Users.Where(u => !u.EmailConfirmed && u.Email != null && u.PasswordHash != null
            && !u.Logins.Any() && !u.Habits.Any() && !u.Routines.Any() && !u.DayMarks.Any() && !u.DayNotes.Any()
            && !u.Moods.Any() && !u.PushSubscriptions.Any() && u.JournalKey == null);

        var cutoff = _time.GetUtcNow() - UnconfirmedAccountLifetime;
        var stale = (await deletable.Select(u => u.Id).ToListAsync(cancellationToken))
            .Where(id => id.Version == 7 && UuidV7Time(id) < cutoff)
            .ToList();
        if (stale.Count == 0) return 0;

        return await deletable.Where(u => stale.Contains(u.Id)).ExecuteDeleteAsync(cancellationToken);
    }

    /// <summary>
    /// Deletes every expired sign-in session (<see cref="AuthSession"/>) and every phone whose session no longer exists. Returns how
    /// many sessions were deleted.
    /// </summary>
    public async Task<int> DeleteExpiredSessionsAsync(CancellationToken cancellationToken = default)
    {
        var now = _time.GetUtcNow();
        var deleted = await _db.AuthSessions.Where(s => s.ExpiresUtc <= now).ExecuteDeleteAsync(cancellationToken);
        await _db.ReminderPhones.Where(p => !_db.AuthSessions.Any(s => s.Id == p.SessionId)).ExecuteDeleteAsync(cancellationToken);
        return deleted;
    }

    private static DateTimeOffset UuidV7Time(Guid id)
    {
        Span<byte> bytes = stackalloc byte[16];
        id.TryWriteBytes(bytes, bigEndian: true, out _);
        return DateTimeOffset.FromUnixTimeMilliseconds(System.Buffers.Binary.BinaryPrimitives.ReadInt64BigEndian(bytes) >>> 16);
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
        => TimezoneHelper.NextOccurrenceUtc(habit.ReminderTimes, tz, _time.GetUtcNow().UtcDateTime);

    /// <summary>
    /// The reminder times sorted ascending without repeats, keeping the earliest <paramref name="max"/>
    /// (a habit's <see cref="Habit.TimesPerDay"/>).
    /// </summary>
    public static List<TimeOnly> NormalizeReminderTimes(IEnumerable<TimeOnly> times, int max)
        => times.Distinct().Order().Take(max).ToList();

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

    /// <summary>The user's <see cref="User.Language"/>; <see cref="Languages.English"/> when the user doesn't exist.</summary>
    public async Task<string> GetLanguageAsync(Guid userId)
        => await _db.Users.Where(u => u.Id == userId).Select(u => u.Language).FirstOrDefaultAsync() ?? Languages.English;

    /// <summary>Sets <see cref="User.Language"/>; the caller passes one of <see cref="Languages.All"/>.</summary>
    public async Task SetLanguageAsync(Guid userId, string language)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.Language, language));
    }

    public async Task SetThemeAsync(Guid userId, string theme)
    {
        await _db.Users
            .Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.Theme, theme));
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

    /// <summary>
    /// The user with their logins, push subscriptions, phones, every habit, log, day mark, routine, journal entry and own mood, and the
    /// journal key (untracked), or null when Ember stores nothing about them.
    /// </summary>
    public Task<User?> GetUserForExportAsync(Guid userId)
        => _db.Users
            .AsNoTracking()
            .Include(u => u.Logins)
            .Include(u => u.Habits).ThenInclude(h => h.Logs)
            .Include(u => u.DayMarks)
            .Include(u => u.PushSubscriptions)
            .Include(u => u.ReminderPhones)
            .Include(u => u.Routines)
            .Include(u => u.DayNotes)
            .Include(u => u.Moods)
            .Include(u => u.JournalKey)
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

    /// <summary>
    /// The given users (tracked) with their logins, habits, logs and day marks; with <paramref name="logsSince"/> only the logs on or
    /// after that day.
    /// </summary>
    public Task<List<User>> GetUsersWithHabitsAsync(List<Guid> userIds, CancellationToken cancellationToken = default,
        DateOnly? logsSince = null)
    {
        IQueryable<User> users = logsSince is { } since
            ? _db.Users.Include(u => u.Logins).Include(u => u.Habits).ThenInclude(h => h.Logs.Where(l => l.Date >= since))
            : _db.Users.Include(u => u.Logins).Include(u => u.Habits).ThenInclude(h => h.Logs);
        return users
            .Include(u => u.DayMarks)
            .AsSplitQuery()
            .Where(u => userIds.Contains(u.Id))
            .ToListAsync(cancellationToken);
    }

    /// <summary>Id and due time of each habit whose next reminder is due at or before <paramref name="nowUtc"/>.</summary>
    public async Task<List<(int Id, DateTime DueAt)>> GetDueReminderHabitsAsync(DateTime nowUtc, CancellationToken cancellationToken = default)
        => (await _db.Habits
            .Where(h => h.NextReminderUtc != null && h.NextReminderUtc <= nowUtc)
            .Select(h => new { h.Id, DueAt = h.NextReminderUtc!.Value })
            .ToListAsync(cancellationToken))
            .Select(h => (h.Id, h.DueAt)).ToList();

    /// <summary>
    /// The habit (tracked) with its routine, its user and the user's logins and push subscriptions, regardless of owner.
    /// Persist edits with <see cref="SaveChangesAsync"/>.
    /// </summary>
    public Task<Habit?> GetHabitWithUserAsync(int habitId, CancellationToken cancellationToken = default)
        => _db.Habits
            .Include(h => h.Routine)
            .Include(h => h.User).ThenInclude(u => u.Logins)
            .Include(h => h.User).ThenInclude(u => u.PushSubscriptions)
            .AsSplitQuery()
            .FirstOrDefaultAsync(h => h.Id == habitId, cancellationToken);

    public Task<bool> IsCompletedOnAsync(int habitId, DateOnly date, CancellationToken cancellationToken = default)
        => _db.HabitLogs.AnyAsync(l => l.HabitId == habitId && l.Date == date && l.Completed, cancellationToken);

    /// <summary>Completed logs of the habit dated strictly between <paramref name="after"/> and <paramref name="before"/>.</summary>
    public Task<int> CountCompletedBetweenAsync(int habitId, DateOnly after, DateOnly before, CancellationToken cancellationToken = default)
        => _db.HabitLogs.CountAsync(l => l.HabitId == habitId && l.Date > after && l.Date < before && l.Completed, cancellationToken);

    /// <summary>Saves pending changes to entities loaded through this service.</summary>
    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => _db.SaveChangesAsync(cancellationToken);

    /// <summary>
    /// Moves the habit's next reminder directly in the database to the first occurrence of any of its reminder times after
    /// <paramref name="nowUtc"/> in the user's timezone, or clears it when the habit has no reminder time.
    /// </summary>
    public async Task DeferReminderAsync(int habitId, DateTime nowUtc, CancellationToken cancellationToken = default)
    {
        var row = await _db.Habits.Where(h => h.Id == habitId)
            .Select(h => new { h.ReminderTimes, h.User.Timezone })
            .FirstOrDefaultAsync(cancellationToken);
        if (row is null) return;

        var next = TimezoneHelper.NextOccurrenceUtc(row.ReminderTimes, TimezoneHelper.Find(row.Timezone) ?? TimeZoneInfo.Utc, nowUtc);
        await _db.Habits
            .Where(h => h.Id == habitId)
            .ExecuteUpdateAsync(s => s.SetProperty(h => h.NextReminderUtc, next), cancellationToken);
    }
}
