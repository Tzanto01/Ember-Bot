using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>Outcome of <see cref="HabitService.PutHelpsAsync"/>.</summary>
public enum HelpsWriteResult
{
    Saved,

    /// <summary>The stored version isn't the one the client last read. Nothing was written.</summary>
    VersionMismatch,

    /// <summary>The private journal is off or turning off. Nothing was written.</summary>
    JournalOff,
}

/// <summary>The "What helps me" list, stored only as client-side ciphertext while the private journal is on.</summary>
public partial class HabitService
{
    /// <summary>The user's stored list, or null when there is none.</summary>
    public Task<UserHelps?> GetHelpsAsync(Guid userId)
        => _db.UserHelps.AsNoTracking().FirstOrDefaultAsync(h => h.UserId == userId);

    /// <summary>
    /// Stores <paramref name="encrypted"/> when the stored version is <paramref name="expectedVersion"/> (0 when there is none) and the
    /// private journal is on and not turning off; the journal key row is locked meanwhile so a turn-off can't slip in. Returns the
    /// new version on <see cref="HelpsWriteResult.Saved"/>. Callers validate the value and consent.
    /// </summary>
    public async Task<(HelpsWriteResult Result, int Version)> PutHelpsAsync(Guid userId, string encrypted, int expectedVersion)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync();
        var keyOn = await _db.Database
            .SqlQuery<int>($"""SELECT 1 AS "Value" FROM "JournalKeys" WHERE "UserId" = {userId} AND NOT "TurningOff" FOR UPDATE""")
            .ToListAsync();
        if (keyOn.Count == 0) return (HelpsWriteResult.JournalOff, 0);

        var now = _time.GetUtcNow().UtcDateTime;
        if (expectedVersion == 0)
        {
            if (await _db.UserHelps.AnyAsync(h => h.UserId == userId)) return (HelpsWriteResult.VersionMismatch, 0);

            var helps = _db.UserHelps.Add(new UserHelps { UserId = userId, Encrypted = encrypted, Version = 1, UpdatedAt = now }).Entity;
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                _db.Entry(helps).State = EntityState.Detached;
                return (HelpsWriteResult.VersionMismatch, 0);
            }
        }
        else if (await _db.UserHelps
                     .Where(h => h.UserId == userId && h.Version == expectedVersion)
                     .ExecuteUpdateAsync(s => s
                         .SetProperty(h => h.Encrypted, encrypted)
                         .SetProperty(h => h.Version, h => h.Version + 1)
                         .SetProperty(h => h.UpdatedAt, now)) != 1)
        {
            return (HelpsWriteResult.VersionMismatch, 0);
        }

        await transaction.CommitAsync();
        return (HelpsWriteResult.Saved, expectedVersion + 1);
    }

    /// <summary>Deletes the user's list, if there is one.</summary>
    public async Task DeleteHelpsAsync(Guid userId)
        => await _db.UserHelps.Where(h => h.UserId == userId).ExecuteDeleteAsync();
}
