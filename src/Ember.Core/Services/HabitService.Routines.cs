using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>Outcome of creating or editing a routine.</summary>
public enum RoutineWriteResult
{
    Saved,

    /// <summary>The routine, or one of the listed habits, isn't the user's. Nothing was written.</summary>
    NotFound,

    /// <summary>The user already has <see cref="HabitService.MaxRoutinesPerUser"/> routines. Nothing was written.</summary>
    LimitReached,
}

/// <summary>Routines: named, ordered groups of habits with an optional shared reminder.</summary>
public partial class HabitService
{
    /// <summary>Most routines a single user can have.</summary>
    public const int MaxRoutinesPerUser = 10;

    /// <summary>
    /// The routine members a reminder on the user's local <paramref name="today"/> is for: those whose day (<see cref="DayOn"/>)
    /// is pending or partial, in <see cref="Habit.RoutinePosition"/> order. Done, offday, paused, low and not-started days are left out.
    /// Needs each habit's log of <paramref name="today"/> loaded, if there is one.
    /// </summary>
    public static List<Habit> PendingRoutineHabits(IEnumerable<Habit> members, DateOnly today, TimeZoneInfo tz, IReadOnlySet<DateOnly> lowDays)
        => members
            .OrderBy(h => h.RoutinePosition)
            .Where(h => DayOn(h, today, today, tz, lowDays).State is DayState.Pending or DayState.Partial)
            .ToList();

    /// <summary>The user's routines (oldest first) with their member habits ordered by <see cref="Habit.RoutinePosition"/>.</summary>
    public Task<List<Routine>> GetRoutinesAsync(Guid userId)
        => _db.Routines
            .AsNoTracking()
            .Where(r => r.UserId == userId)
            .Include(r => r.Habits.OrderBy(h => h.RoutinePosition))
            .OrderBy(r => r.CreatedAt).ThenBy(r => r.Id)
            .ToListAsync();

    /// <summary>
    /// Creates a routine. <paramref name="habitIds"/> (ordered) become its members, moving them out of any other routine.
    /// </summary>
    public async Task<(RoutineWriteResult Result, Routine? Routine)> AddRoutineAsync(Guid userId, string name, TimeOnly? reminderTime,
        ReminderChannels channels, IReadOnlyList<int>? habitIds)
    {
        if (await _db.Routines.CountAsync(r => r.UserId == userId) >= MaxRoutinesPerUser)
            return (RoutineWriteResult.LimitReached, null);

        var routine = new Routine
        {
            UserId = userId,
            Name = name,
            ReminderTime = reminderTime,
            ReminderChannels = channels,
            CreatedAt = _time.GetUtcNow().UtcDateTime,
        };
        if (habitIds is not null && !await SetRoutineHabitsAsync(userId, routine, habitIds))
            return (RoutineWriteResult.NotFound, null);

        routine.NextReminderUtc = NextReminderUtc(routine, await GetUserTzAsync(userId));
        _db.Routines.Add(routine);
        await _db.SaveChangesAsync();
        return (RoutineWriteResult.Saved, routine);
    }

    /// <summary>
    /// Edits the user's routine; null arguments keep the current value. <paramref name="habitIds"/> (ordered) replaces the members:
    /// listed habits move into this routine, members not listed leave it.
    /// </summary>
    public async Task<RoutineWriteResult> EditRoutineAsync(Guid userId, int routineId, string? name, TimeOnly? reminderTime,
        bool clearReminder, ReminderChannels? channels, IReadOnlyList<int>? habitIds)
    {
        var routine = await _db.Routines
            .Include(r => r.Habits)
            .FirstOrDefaultAsync(r => r.Id == routineId && r.UserId == userId);
        if (routine is null) return RoutineWriteResult.NotFound;
        if (habitIds is not null && !await SetRoutineHabitsAsync(userId, routine, habitIds))
            return RoutineWriteResult.NotFound;

        if (name is not null) routine.Name = name;
        if (channels is { } c) routine.ReminderChannels = c;
        if (clearReminder)
        {
            routine.ReminderTime = null;
            routine.NextReminderUtc = null;
        }
        else if (reminderTime.HasValue)
        {
            routine.ReminderTime = reminderTime;
            routine.NextReminderUtc = NextReminderUtc(routine, await GetUserTzAsync(userId));
        }

        await _db.SaveChangesAsync();
        return RoutineWriteResult.Saved;
    }

    /// <summary>Deletes the user's routine; its habits stay, ungrouped. False when the routine isn't the user's.</summary>
    public async Task<bool> DeleteRoutineAsync(Guid userId, int routineId)
        => await _db.Routines
            .Where(r => r.Id == routineId && r.UserId == userId)
            .ExecuteDeleteAsync() == 1;

    /// <summary>Id and due time of each routine whose next reminder is due at or before <paramref name="nowUtc"/>.</summary>
    public async Task<List<(int Id, DateTime DueAt)>> GetDueReminderRoutinesAsync(DateTime nowUtc, CancellationToken cancellationToken = default)
        => (await _db.Routines
            .Where(r => r.NextReminderUtc != null && r.NextReminderUtc <= nowUtc)
            .Select(r => new { r.Id, DueAt = r.NextReminderUtc!.Value })
            .ToListAsync(cancellationToken))
            .Select(r => (r.Id, r.DueAt)).ToList();

    /// <summary>
    /// The routine (tracked) with its member habits and their logs of the last two UTC days onward (enough for any local today),
    /// and its user with logins and push subscriptions, regardless of owner. Persist edits with <see cref="SaveChangesAsync"/>.
    /// </summary>
    public Task<Routine?> GetRoutineWithUserAsync(int routineId, CancellationToken cancellationToken = default)
    {
        var since = DateOnly.FromDateTime(_time.GetUtcNow().UtcDateTime).AddDays(-2);
        return _db.Routines
            .Include(r => r.Habits).ThenInclude(h => h.Logs.Where(l => l.Date >= since))
            .Include(r => r.User).ThenInclude(u => u.Logins)
            .Include(r => r.User).ThenInclude(u => u.PushSubscriptions)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == routineId, cancellationToken);
    }

    /// <summary>
    /// Moves the routine's next reminder directly in the database to the first occurrence of its reminder time after
    /// <paramref name="nowUtc"/> in the user's timezone, or clears it when the routine has no reminder time.
    /// </summary>
    public async Task DeferRoutineReminderAsync(int routineId, DateTime nowUtc, CancellationToken cancellationToken = default)
    {
        var row = await _db.Routines.Where(r => r.Id == routineId)
            .Select(r => new { r.ReminderTime, r.User.Timezone })
            .FirstOrDefaultAsync(cancellationToken);
        if (row is null) return;

        DateTime? next = row.ReminderTime is { } time
            ? TimezoneHelper.NextOccurrenceUtc(time, TimezoneHelper.Find(row.Timezone) ?? TimeZoneInfo.Utc, nowUtc)
            : null;
        await _db.Routines
            .Where(r => r.Id == routineId)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.NextReminderUtc, next), cancellationToken);
    }

    /// <summary>
    /// Makes <paramref name="habitIds"/> the routine's members in that order. Members of a tracked routine must be loaded.
    /// False, changing nothing, when any id isn't one of the user's habits.
    /// </summary>
    private async Task<bool> SetRoutineHabitsAsync(Guid userId, Routine routine, IReadOnlyList<int> habitIds)
    {
        var listed = await _db.Habits
            .Where(h => h.UserId == userId && habitIds.Contains(h.Id))
            .ToDictionaryAsync(h => h.Id);
        if (habitIds.Any(id => !listed.ContainsKey(id))) return false;

        foreach (var member in routine.Habits.Where(h => !listed.ContainsKey(h.Id)).ToList())
            routine.Habits.Remove(member);
        for (var i = 0; i < habitIds.Count; i++)
        {
            var habit = listed[habitIds[i]];
            habit.RoutinePosition = i;
            if (!routine.Habits.Contains(habit)) routine.Habits.Add(habit);
        }
        return true;
    }

    private DateTime? NextReminderUtc(Routine routine, TimeZoneInfo tz)
        => routine.ReminderTime is { } time
            ? TimezoneHelper.NextOccurrenceUtc(time, tz, _time.GetUtcNow().UtcDateTime)
            : null;
}
