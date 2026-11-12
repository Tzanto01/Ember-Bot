using Ember.Core.Services;

namespace Ember.Bot.Services;

/// <summary>
/// In-memory limit of <see cref="MaxPerWindow"/> <c>/feedback</c> submissions per Discord user in any <see cref="Window"/>, and
/// of <see cref="HabitService.MaxFeedbackImageBytesPerUserPerDay"/> picture bytes per Discord user in any <see cref="BytesWindow"/>.
/// A restart resets it.
/// </summary>
public sealed class FeedbackCooldown(TimeProvider time)
{
    public const int MaxPerWindow = 5;

    public static readonly TimeSpan Window = TimeSpan.FromHours(1);

    public static readonly TimeSpan BytesWindow = TimeSpan.FromDays(1);

    private readonly Dictionary<ulong, Queue<DateTimeOffset>> _sent = [];

    private readonly Dictionary<ulong, Queue<(DateTimeOffset At, long Bytes)>> _bytes = [];

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

    /// <summary>
    /// Counts <paramref name="bytes"/> picture bytes by the user now and returns true, or returns false without counting when they
    /// would take the user over <see cref="HabitService.MaxFeedbackImageBytesPerUserPerDay"/>.
    /// </summary>
    public bool TryRecordBytes(ulong discordUserId, long bytes)
    {
        lock (_bytes)
        {
            var now = time.GetUtcNow();
            if (!_bytes.TryGetValue(discordUserId, out var sent)) _bytes[discordUserId] = sent = new Queue<(DateTimeOffset, long)>();
            while (sent.Count > 0 && now - sent.Peek().At >= BytesWindow) sent.Dequeue();
            if (sent.Sum(s => s.Bytes) + bytes > HabitService.MaxFeedbackImageBytesPerUserPerDay)
            {
                if (sent.Count == 0) _bytes.Remove(discordUserId);
                return false;
            }

            sent.Enqueue((now, bytes));
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
