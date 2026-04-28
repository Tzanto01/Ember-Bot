using Ember.Bot.Data;
using Ember.Bot.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Bot.Services;

public class HabitService
{
    private readonly EmberDbContext _db;
    private readonly ReminderScheduler _scheduler;

    public HabitService(EmberDbContext db, ReminderScheduler scheduler)
    {
        _db        = db;
        _scheduler = scheduler;
    }

    // Ensure a User row exists for this Discord user
    public async Task EnsureUserAsync(ulong discordUserId)
    {
        var id = (long)discordUserId;
        if (!await _db.Users.AnyAsync(u => u.DiscordUserId == id))
        {
            _db.Users.Add(new User { DiscordUserId = id });
            await _db.SaveChangesAsync();
        }
    }

    public async Task<Habit> AddHabitAsync(ulong discordUserId, string name, TimeOnly? reminderTime,
        FrequencyType frequency = FrequencyType.Daily, int? weeklyTarget = null)
    {
        await EnsureUserAsync(discordUserId);
        var habit = new Habit
        {
            UserId = (long)discordUserId,
            Name = name,
            ReminderTime = reminderTime,
            FrequencyType = frequency,
            WeeklyTarget = frequency == FrequencyType.Weekly ? (weeklyTarget ?? 3) : null,
            CreatedAt = DateTime.UtcNow
        };
        _db.Habits.Add(habit);
        await _db.SaveChangesAsync();

        await _scheduler.ScheduleAsync(habit, await GetUserTzAsync(discordUserId));

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

    public async Task<HabitLog?> CheckInAsync(ulong discordUserId, int habitId, bool completed, ulong? guildId = null)
    {
        var habit = await _db.Habits
            .FirstOrDefaultAsync(h => h.Id == habitId && h.UserId == (long)discordUserId);

        if (habit is null) return null;

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var existing = await _db.HabitLogs
            .FirstOrDefaultAsync(l => l.HabitId == habitId && l.Date == today);

        if (existing is not null)
        {
            existing.Completed = completed;
            if (guildId.HasValue) existing.GuildId = (long)guildId.Value;
            await _db.SaveChangesAsync();
            return existing;
        }

        var log = new HabitLog
        {
            HabitId = habitId,
            Date = today,
            Completed = completed,
            GuildId = guildId.HasValue ? (long)guildId.Value : null
        };
        _db.HabitLogs.Add(log);
        await _db.SaveChangesAsync();
        return log;
    }

    /// <summary>
    /// Returns how many of the last <paramref name="days"/> days were completed,
    /// using a rolling window. Paused days are excluded from the window.
    /// </summary>
    public static int FlexibleStreak(Habit habit, int days = 7)
    {
        var cutoff = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-(days - 1));
        return habit.Logs.Count(l => l.Completed && l.Date >= cutoff);
    }

    /// <summary>
    /// Returns the longest consecutive completed-day run, with up to
    /// <paramref name="graceDays"/> forgiven gaps per 7-day window.
    /// Also returns how many grace days were used in the current active streak.
    /// </summary>
    public static (int streak, int graceUsed) ConsecutiveStreak(Habit habit, int graceDays = 1)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

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

        // Start from today (or yesterday if today isn't checked in and isn't paused).
        var day = today;
        if (!completed.Contains(today) && !IsPaused(habit, today))
            day = today.AddDays(-1);

        while (day >= floor)
        {
            if (IsPaused(habit, day))
            {
                // Paused — skip without grace, but guard against underflow
                if (day == floor) break;
                day = day.AddDays(-1);
                continue;
            }

            if (completed.Contains(day))
            {
                streak++;
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

    private static bool IsPaused(Habit habit, DateOnly date)
        => habit.PausedUntil.HasValue && date <= habit.PausedUntil.Value;

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
    /// is Monday–Sunday containing today.
    /// </summary>
    public static (int done, int target) WeeklyProgress(Habit habit)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        // Find Monday of this week
        var dow = (int)today.DayOfWeek; // 0=Sun
        var monday = today.AddDays(dow == 0 ? -6 : -(dow - 1));
        var sunday = monday.AddDays(6);

        var done = habit.Logs.Count(l => l.Completed && l.Date >= monday && l.Date <= sunday);
        var target = habit.WeeklyTarget ?? 3;
        return (done, target);
    }

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
        await _scheduler.UnscheduleAsync(habitId);
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
            await _scheduler.UnscheduleAsync(habitId);
        }
        else if (newReminderTime.HasValue)
        {
            habit.ReminderTime = newReminderTime;
            await _scheduler.ScheduleAsync(habit, await GetUserTzAsync(discordUserId));
        }

        await _db.SaveChangesAsync();
        return habit;
    }

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

    public async Task SetLeaderboardOptOutAsync(ulong discordUserId, bool optOut)
    {
        await EnsureUserAsync(discordUserId);
        var user = await _db.Users.FirstAsync(u => u.DiscordUserId == (long)discordUserId);
        user.LeaderboardOptOut = optOut;
        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// Returns the top N users in a guild by total completed check-ins this week.
    /// Excludes opted-out users.
    /// </summary>
    public async Task<List<(ulong UserId, string DisplayName, int CheckIns, int BestStreak)>> GetLeaderboardAsync(
        ulong guildId, int top = 10)
    {
        var weekAgo = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-6);
        var guildIdLong = (long)guildId;

        var rows = await _db.HabitLogs
            .Where(l => l.GuildId == guildIdLong && l.Completed && l.Date >= weekAgo)
            .Include(l => l.Habit)
                .ThenInclude(h => h.User)
            .ToListAsync();

        return rows
            .Where(l => !l.Habit.User.LeaderboardOptOut)
            .GroupBy(l => l.Habit.UserId)
            .Select(g => (
                UserId: (ulong)g.Key,
                DisplayName: $"<@{g.Key}>",
                CheckIns: g.Count(),
                BestStreak: 0 // filled by caller who has Discord context
            ))
            .OrderByDescending(x => x.CheckIns)
            .Take(top)
            .ToList();
    }

    public async Task<TimeZoneInfo> GetUserTzAsync(ulong discordUserId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.DiscordUserId == (long)discordUserId);
        return TimezoneHelper.Find(user?.Timezone ?? "UTC") ?? TimeZoneInfo.Utc;
    }

    public async Task<bool> HasTimezoneSetAsync(ulong discordUserId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.DiscordUserId == (long)discordUserId);
        return user?.Timezone is not null && user.Timezone != "UTC";
    }
}
