using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>An opaque client-side AES-GCM blob of the private journal (base64 <paramref name="Iv"/> and <paramref name="Text"/>).</summary>
public sealed record JournalCipher(int Version, string Iv, string Text);

/// <summary>The private-journal state of an account: whether a key exists, and how many entries and own moods are stored in each form.</summary>
public sealed record JournalState(bool Encrypted, bool TurningOff, int PlaintextLeft, int EncryptedLeft);

/// <summary>Outcome of creating or editing an own mood.</summary>
public enum MoodWriteResult
{
    Saved,

    /// <summary>The mood isn't the user's. Nothing was written.</summary>
    NotFound,

    /// <summary>The write would leave more than <see cref="HabitService.MaxActiveMoodsPerUser"/> non-archived moods. Nothing was written.</summary>
    LimitReached,
}

/// <summary>The journal for the day, own moods and the private-journal key. Never shown by the bot, notifications or the weekly summary.</summary>
public partial class HabitService
{
    /// <summary>Most non-archived own moods a single user can have.</summary>
    public const int MaxActiveMoodsPerUser = 20;

    /// <summary>The user's day notes from <paramref name="from"/> to <paramref name="to"/> (inclusive), oldest first.</summary>
    public Task<List<DayNote>> GetDayNotesAsync(Guid userId, DateOnly from, DateOnly to)
        => _db.DayNotes
            .AsNoTracking()
            .Where(n => n.UserId == userId && n.Date >= from && n.Date <= to)
            .OrderBy(n => n.Date)
            .ToListAsync();

    /// <summary>The user's day note for <paramref name="date"/>, or null.</summary>
    public Task<DayNote?> GetDayNoteAsync(Guid userId, DateOnly date)
        => _db.DayNotes.AsNoTracking().FirstOrDefaultAsync(n => n.UserId == userId && n.Date == date);

    /// <summary>
    /// Replaces the user's day note for <paramref name="date"/> with plaintext <paramref name="text"/>/<paramref name="mood"/> or,
    /// when <paramref name="cipher"/> is set, with that blob (clearing the other form). With nothing set the note is deleted and null returned.
    /// Callers validate the values, the date range and consent.
    /// </summary>
    public async Task<DayNote?> SetDayNoteAsync(Guid userId, DateOnly date, string? text, string? mood, JournalCipher? cipher)
    {
        if (text is null && mood is null && cipher is null)
        {
            await DeleteDayNoteAsync(userId, date);
            return null;
        }

        var note = await _db.DayNotes.FirstOrDefaultAsync(n => n.UserId == userId && n.Date == date);
        var isNew = note is null;
        note ??= _db.DayNotes.Add(new DayNote { UserId = userId, Date = date }).Entity;
        ApplyDayNote(note, text, mood, cipher);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (isNew)
        {
            _db.Entry(note).State = EntityState.Detached;
            note = await _db.DayNotes.FirstOrDefaultAsync(n => n.UserId == userId && n.Date == date);
            if (note is null) throw;
            ApplyDayNote(note, text, mood, cipher);
            await _db.SaveChangesAsync();
        }
        return note;
    }

    /// <summary>Deletes the user's day note for <paramref name="date"/>, if there is one.</summary>
    public async Task DeleteDayNoteAsync(Guid userId, DateOnly date)
        => await _db.DayNotes.Where(n => n.UserId == userId && n.Date == date).ExecuteDeleteAsync();

    /// <summary>All the user's own moods, archived ones included, ordered by id.</summary>
    public Task<List<Mood>> GetMoodsAsync(Guid userId)
        => _db.Moods.AsNoTracking().Where(m => m.UserId == userId).OrderBy(m => m.Id).ToListAsync();

    /// <summary>The user's own mood, or null when it doesn't exist or isn't theirs.</summary>
    public Task<Mood?> GetMoodAsync(Guid userId, int moodId)
        => _db.Moods.AsNoTracking().FirstOrDefaultAsync(m => m.Id == moodId && m.UserId == userId);

    /// <summary>Creates an own mood, plaintext (<paramref name="label"/>, <paramref name="emoji"/>) or encrypted (<paramref name="cipher"/>).</summary>
    public async Task<(MoodWriteResult Result, Mood? Mood)> AddMoodAsync(Guid userId, string? label, string? emoji, JournalCipher? cipher,
        bool archived)
    {
        if (!archived && await CountActiveMoodsAsync(userId) >= MaxActiveMoodsPerUser)
            return (MoodWriteResult.LimitReached, null);

        var mood = new Mood { UserId = userId, Archived = archived, CreatedAt = _time.GetUtcNow().UtcDateTime };
        ApplyMood(mood, label, emoji, cipher);
        _db.Moods.Add(mood);
        await _db.SaveChangesAsync();
        return (MoodWriteResult.Saved, mood);
    }

    /// <summary>
    /// Edits the user's own mood. A non-null <paramref name="label"/> stores it as plaintext with <paramref name="emoji"/>; a non-null
    /// <paramref name="cipher"/> stores it encrypted; with neither, only <paramref name="archived"/> (when set) changes.
    /// </summary>
    public async Task<(MoodWriteResult Result, Mood? Mood)> EditMoodAsync(Guid userId, int moodId, string? label, string? emoji,
        JournalCipher? cipher, bool? archived)
    {
        var mood = await _db.Moods.FirstOrDefaultAsync(m => m.Id == moodId && m.UserId == userId);
        if (mood is null) return (MoodWriteResult.NotFound, null);
        if (archived == false && mood.Archived && await CountActiveMoodsAsync(userId) >= MaxActiveMoodsPerUser)
            return (MoodWriteResult.LimitReached, null);

        if (label is not null || cipher is not null) ApplyMood(mood, label, emoji, cipher);
        if (archived is { } a) mood.Archived = a;
        await _db.SaveChangesAsync();
        return (MoodWriteResult.Saved, mood);
    }

    /// <summary>The user's private-journal key, or null when the private journal is off.</summary>
    public Task<JournalKey?> GetJournalKeyAsync(Guid userId)
        => _db.JournalKeys.AsNoTracking().FirstOrDefaultAsync(k => k.UserId == userId);

    /// <summary>
    /// Creates the key (version 1) when <paramref name="ifVersion"/> is null and none exists, or replaces the wrapped material of the
    /// key at exactly <paramref name="ifVersion"/> (version + 1). Returns the stored key, or null when the condition didn't hold.
    /// </summary>
    public async Task<JournalKey?> PutJournalKeyAsync(Guid userId, JournalKey material, int? ifVersion)
    {
        if (ifVersion is not { } expected)
        {
            if (await _db.JournalKeys.AnyAsync(k => k.UserId == userId)) return null;

            material.UserId = userId;
            material.Version = 1;
            material.TurningOff = false;
            _db.JournalKeys.Add(material);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                _db.Entry(material).State = EntityState.Detached;
                return null;
            }
            return material;
        }

        var updated = await _db.JournalKeys
            .Where(k => k.UserId == userId && k.Version == expected)
            .ExecuteUpdateAsync(s => s
                .SetProperty(k => k.PassphraseSalt, material.PassphraseSalt)
                .SetProperty(k => k.PassphraseIterations, material.PassphraseIterations)
                .SetProperty(k => k.PassphraseIv, material.PassphraseIv)
                .SetProperty(k => k.PassphraseWrapped, material.PassphraseWrapped)
                .SetProperty(k => k.RecoverySalt, material.RecoverySalt)
                .SetProperty(k => k.RecoveryIv, material.RecoveryIv)
                .SetProperty(k => k.RecoveryWrapped, material.RecoveryWrapped)
                .SetProperty(k => k.Version, k => k.Version + 1));
        return updated == 1 ? await GetJournalKeyAsync(userId) : null;
    }

    /// <summary>Marks the key as turning off (version + 1 the first time). Returns the key, or null when there is none.</summary>
    public async Task<JournalKey?> TurnOffJournalAsync(Guid userId)
    {
        await _db.JournalKeys
            .Where(k => k.UserId == userId && !k.TurningOff)
            .ExecuteUpdateAsync(s => s
                .SetProperty(k => k.TurningOff, true)
                .SetProperty(k => k.Version, k => k.Version + 1));
        return await GetJournalKeyAsync(userId);
    }

    /// <summary>
    /// Deletes the key and the "What helps me" list. With <paramref name="discardEncrypted"/>, first deletes every encrypted day note and own mood, in one transaction;
    /// without it, returns false and deletes nothing while any encrypted entry or mood remains.
    /// </summary>
    public async Task<bool> DeleteJournalKeyAsync(Guid userId, bool discardEncrypted)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync();
        if (discardEncrypted)
        {
            await _db.DayNotes.Where(n => n.UserId == userId && n.CipherVersion != null).ExecuteDeleteAsync();
            await _db.Moods.Where(m => m.UserId == userId && m.CipherVersion != null).ExecuteDeleteAsync();
        }
        else if (await _db.DayNotes.AnyAsync(n => n.UserId == userId && n.CipherVersion != null)
            || await _db.Moods.AnyAsync(m => m.UserId == userId && m.CipherVersion != null))
        {
            return false;
        }

        await _db.UserHelps.Where(h => h.UserId == userId).ExecuteDeleteAsync();
        await _db.JournalKeys.Where(k => k.UserId == userId).ExecuteDeleteAsync();
        await transaction.CommitAsync();
        return true;
    }

    /// <summary>The user's <see cref="JournalState"/> for <c>Me.journal</c>.</summary>
    public async Task<JournalState> GetJournalStateAsync(Guid userId)
    {
        var key = await GetJournalKeyAsync(userId);
        var plaintext = await _db.DayNotes.CountAsync(n => n.UserId == userId && n.CipherVersion == null)
            + await _db.Moods.CountAsync(m => m.UserId == userId && m.CipherVersion == null);
        var encrypted = await _db.DayNotes.CountAsync(n => n.UserId == userId && n.CipherVersion != null)
            + await _db.Moods.CountAsync(m => m.UserId == userId && m.CipherVersion != null);
        return new JournalState(key is not null, key?.TurningOff == true, plaintext, encrypted);
    }

    private Task<int> CountActiveMoodsAsync(Guid userId) => _db.Moods.CountAsync(m => m.UserId == userId && !m.Archived);

    private static void ApplyDayNote(DayNote note, string? text, string? mood, JournalCipher? cipher)
    {
        note.Text = cipher is null ? text : null;
        note.Mood = cipher is null ? mood : null;
        note.CipherVersion = cipher?.Version;
        note.CipherIv = cipher?.Iv;
        note.CipherText = cipher?.Text;
    }

    private static void ApplyMood(Mood mood, string? label, string? emoji, JournalCipher? cipher)
    {
        mood.Label = cipher is null ? label : null;
        mood.Emoji = cipher is null ? emoji : null;
        mood.CipherVersion = cipher?.Version;
        mood.CipherIv = cipher?.Iv;
        mood.CipherText = cipher?.Text;
    }
}
