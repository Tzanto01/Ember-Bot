using Discord;
using Ember.Core.Models;

namespace Ember.Bot.Services;

/// <summary>Sends reminders as Discord DMs with Done / Skip / Snooze buttons; routine reminders list the pending habits with a Done button each.</summary>
public class DiscordDmReminderChannel : IReminderChannel
{
    private readonly IDiscordDmSender _discord;
    private readonly TimeProvider _time;

    public DiscordDmReminderChannel(IDiscordDmSender discord, TimeProvider time)
    {
        _discord = discord;
        _time    = time;
    }

    public ReminderChannels Channel => ReminderChannels.Discord;

    public async Task<DeliveryOutcome> SendAsync(Reminder reminder, CancellationToken cancellationToken = default)
    {
        if (reminder.DiscordUserId is not { } discordUserId) return DeliveryOutcome.UserNotFound;
        if (reminder.PendingHabits is { } pending) return await SendRoutineAsync(discordUserId, reminder.HabitName, pending, cancellationToken);

        var name = reminder.HabitName;
        string intro = reminder.Snoozed
            ? $"⏰ Snoozed reminder: **{name}**. Ready when you are!"
            : reminder.RecentCompletions >= 4
                ? $"Hey! Just a gentle nudge for **{name}**. You've been doing great 🔥"
                : reminder.RecentCompletions >= 1
                    ? $"Hey! Reminder for **{name}**. No pressure — just showing up counts 💙"
                    : $"Hey 👋 Checking in on **{name}**. It's been a little while, and that's okay — today's a fresh start whenever you're ready.";

        var message = $"{intro}\n\nDid you follow this habit today?";

        var now = _time.GetUtcNow().ToUnixTimeSeconds();
        var components = new ComponentBuilder()
            .WithButton("Done ✅", $"checkin:done:{reminder.HabitId}:{now}", ButtonStyle.Success)
            .WithButton("Skip ❌", $"checkin:skip:{reminder.HabitId}:{now}", ButtonStyle.Secondary)
            .WithButton("Snooze 1h ⏰", $"checkin:snooze:{reminder.HabitId}:{now}", ButtonStyle.Secondary)
            .Build();

        return await _discord.SendMessageAsync(discordUserId, message, components: components, cancellationToken: cancellationToken);
    }

    /// <summary>Discord allows 25 buttons per message, 5 per row.</summary>
    private const int MaxButtons = 25;
    private const int ButtonsPerRow = 5;
    private const int MaxButtonLabel = 80;

    /// <summary>Keeps the habit list well under Discord's 2000-character message limit.</summary>
    private const int MaxListLength = 1500;

    private async Task<DeliveryOutcome> SendRoutineAsync(ulong discordUserId, string routineName, IReadOnlyList<RoutineHabit> pending,
        CancellationToken cancellationToken)
    {
        var lines = new List<string>();
        var length = 0;
        foreach (var line in pending.Select(h => $"• {h.Name}"))
        {
            if (length + line.Length + 1 > MaxListLength) break;
            lines.Add(line);
            length += line.Length + 1;
        }
        if (lines.Count < pending.Count) lines.Add($"and {pending.Count - lines.Count} more");
        var list = string.Join("\n", lines);
        var message = $"Hey 👋 Time for your **{routineName}** routine. Still open today:\n{list}\n\nTap Done for each one you've done. No pressure 💙";

        var now = _time.GetUtcNow().ToUnixTimeSeconds();
        var components = new ComponentBuilder();
        foreach (var (habit, i) in pending.Take(MaxButtons).Select((h, i) => (h, i)))
        {
            var label = $"Done: {habit.Name}";
            if (label.Length > MaxButtonLabel) label = label[..(MaxButtonLabel - 1)] + "…";
            components.WithButton(label, $"checkin:done:{habit.Id}:{now}", ButtonStyle.Success, row: i / ButtonsPerRow);
        }

        return await _discord.SendMessageAsync(discordUserId, message, components: components.Build(), cancellationToken: cancellationToken);
    }
}
