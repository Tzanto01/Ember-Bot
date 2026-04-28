using Ember.Bot.Data;
using Ember.Bot.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Bot.Services;

public class HabitService
{
    private readonly EmberDbContext _db;

    public HabitService(EmberDbContext db)
    {
        _db = db;
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

    public async Task<Habit> AddHabitAsync(ulong discordUserId, string name, TimeOnly? reminderTime)
    {
        await EnsureUserAsync(discordUserId);
        var habit = new Habit
        {
            UserId = (long)discordUserId,
            Name = name,
            ReminderTime = reminderTime,
            CreatedAt = DateTime.UtcNow
        };
        _db.Habits.Add(habit);
        await _db.SaveChangesAsync();
        return habit;
    }

    public async Task<List<Habit>> GetHabitsAsync(ulong discordUserId)
    {
        return await _db.Habits
            .Where(h => h.UserId == (long)discordUserId)
            .Include(h => h.Logs)
            .OrderBy(h => h.CreatedAt)
            .ToListAsync();
    }

    public async Task<HabitLog?> CheckInAsync(ulong discordUserId, int habitId, bool completed)
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
            await _db.SaveChangesAsync();
            return existing;
        }

        var log = new HabitLog { HabitId = habitId, Date = today, Completed = completed };
        _db.HabitLogs.Add(log);
        await _db.SaveChangesAsync();
        return log;
    }

    /// <summary>Returns how many of the last <paramref name="days"/> days were completed.</summary>
    public static int FlexibleStreak(Habit habit, int days = 7)
    {
        var cutoff = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-(days - 1));
        return habit.Logs.Count(l => l.Completed && l.Date >= cutoff);
    }

    /// <summary>Returns the longest consecutive completed-day streak.</summary>
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
}
