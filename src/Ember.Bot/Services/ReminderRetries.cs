using System.Collections.Concurrent;

namespace Ember.Bot.Services;

/// <summary>
/// In-memory failed attempts per due reminder (kind, id and due time), so a reminder whose send failed transiently, or whose
/// processing threw, is tried at most <see cref="MaxAttempts"/> times, <see cref="Spacing"/> apart. A restart resets it.
/// </summary>
public sealed class ReminderRetries
{
    public const int MaxAttempts = 3;

    public static readonly TimeSpan Spacing = TimeSpan.FromMinutes(5);

    private readonly ConcurrentDictionary<(string Kind, int Id, DateTime DueAt), (int Failures, DateTime LastAt, bool Delivered)> _attempts = new();

    /// <summary>False while the last failed attempt of the reminder is less than <see cref="Spacing"/> ago.</summary>
    public bool CanAttempt(string kind, int id, DateTime dueAt, DateTime now)
        => !_attempts.TryGetValue((kind, id, dueAt), out var a) || a.Delivered || now - a.LastAt >= Spacing;

    /// <summary>Notes that a channel delivered the reminder, so a later failure in the same attempt never retries it.</summary>
    public void Delivered(string kind, int id, DateTime dueAt, DateTime now)
        => _attempts[(kind, id, dueAt)] = (0, now, true);

    /// <summary>
    /// Records a failed attempt. True, forgetting the reminder, when no retry is left: it was the <see cref="MaxAttempts"/>th failure,
    /// or a channel already delivered it.
    /// </summary>
    public bool Fail(string kind, int id, DateTime dueAt, DateTime now)
    {
        var key = (kind, id, dueAt);
        var a = _attempts.AddOrUpdate(key, (1, now, false), (_, old) => (old.Failures + 1, now, old.Delivered));
        if (a.Failures < MaxAttempts && !a.Delivered) return false;
        _attempts.TryRemove(key, out _);
        return true;
    }

    /// <summary>Forgets the reminder's attempts once it is handled.</summary>
    public void Forget(string kind, int id, DateTime dueAt) => _attempts.TryRemove((kind, id, dueAt), out _);

    /// <summary>Drops attempts last made a day or more before <paramref name="now"/> (reminders that stopped being due).</summary>
    public void Prune(DateTime now)
    {
        foreach (var (key, a) in _attempts)
            if (now - a.LastAt >= TimeSpan.FromDays(1)) _attempts.TryRemove(key, out _);
    }
}
