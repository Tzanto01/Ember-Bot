namespace Ember.Bot.Services;

/// <summary>
/// In-memory limit of <see cref="MaxPerWindow"/> <c>/feedback</c> submissions per Discord user in any <see cref="Window"/>.
/// A restart resets it.
/// </summary>
public sealed class FeedbackCooldown(TimeProvider time)
{
    public const int MaxPerWindow = 5;

    public static readonly TimeSpan Window = TimeSpan.FromHours(1);

    private readonly Dictionary<ulong, Queue<DateTimeOffset>> _sent = [];

    /// <summary>Whether the user may send another feedback now.</summary>
    public bool CanSend(ulong discordUserId)
    {
        lock (_sent) return Recent(discordUserId, time.GetUtcNow()) < MaxPerWindow;
    }

    /// <summary>Counts one feedback by the user now and returns true, or returns false without counting when they are at the limit.</summary>
    public bool TryRecord(ulong discordUserId)
    {
        lock (_sent)
        {
            var now = time.GetUtcNow();
            if (Recent(discordUserId, now) >= MaxPerWindow) return false;

            if (!_sent.TryGetValue(discordUserId, out var sent)) _sent[discordUserId] = sent = new Queue<DateTimeOffset>();
            sent.Enqueue(now);
            return true;
        }
    }

    private int Recent(ulong discordUserId, DateTimeOffset now)
    {
        if (!_sent.TryGetValue(discordUserId, out var sent)) return 0;

        while (sent.Count > 0 && now - sent.Peek() >= Window) sent.Dequeue();
        if (sent.Count == 0) _sent.Remove(discordUserId);
        return sent.Count;
    }
}
