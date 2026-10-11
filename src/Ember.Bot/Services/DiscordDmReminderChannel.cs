using Discord;

namespace Ember.Bot.Services;

/// <summary>Sends reminders as Discord DMs with Done / Skip / Snooze buttons.</summary>
public class DiscordDmReminderChannel : IReminderChannel
{
    private readonly IDiscordDmSender _discord;
    private readonly TimeProvider _time;

    public DiscordDmReminderChannel(IDiscordDmSender discord, TimeProvider time)
    {
        _discord = discord;
        _time    = time;
    }

    public async Task<DeliveryOutcome> SendAsync(Reminder reminder, CancellationToken cancellationToken = default)
    {
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

        var sent = await _discord.SendMessageAsync(reminder.UserId, message, components: components, cancellationToken: cancellationToken);
        return sent ? DeliveryOutcome.Delivered : DeliveryOutcome.UserNotFound;
    }
}
