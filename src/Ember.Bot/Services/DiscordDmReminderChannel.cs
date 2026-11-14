using Ember.Core.Localization;
using Discord;
using Ember.Bot.Modules;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Ember.Bot.Services;

/// <summary>
/// Sends reminders as Discord DMs with Done / Skip / Snooze buttons; routine reminders list the pending habits with a Done button each.
/// Every reminder DM also carries a Stop Discord reminders button.
/// Every delivered reminder is remembered as a <see cref="ReminderMessage"/> until it is closed; a second reminder deletes the
/// earlier messages of the same habit or routine and day (closing them when deleting fails).
/// </summary>
public class DiscordDmReminderChannel : IReminderChannel
{
    /// <summary>Label of the reminder's Skip button; calm, with no red mark.</summary>
    public static string SkipLabel(Texts t) => t.Get("reminder.skip");

    /// <summary>Subtext added to a closed reminder whose habits are done for its day.</summary>
    public static string LoggedLine(Texts t) => t.Get("reminder.logged-line");

    /// <summary>Subtext added to a closed reminder whose habits are not all done for its day.</summary>
    public static string ClosedLine(Texts t) => t.Get("reminder.closed-line");

    private readonly IDiscordDmSender _discord;
    private readonly TimeProvider _time;
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<DiscordDmReminderChannel> _logger;

    public DiscordDmReminderChannel(IDiscordDmSender discord, TimeProvider time, IServiceScopeFactory scopes,
        ILogger<DiscordDmReminderChannel> logger)
    {
        _discord = discord;
        _time    = time;
        _scopes = scopes;
        _logger = logger;
    }

    public ReminderChannels Channel => ReminderChannels.Discord;

    public async Task<DeliveryOutcome> SendAsync(Reminder reminder, CancellationToken cancellationToken = default)
    {
        if (reminder.DiscordUserId is not { } discordUserId) return DeliveryOutcome.UserNotFound;
        var (message, components) = reminder.PendingHabits is { } pending
            ? RoutineMessage(BotTexts.For(reminder.Language), reminder.HabitName, pending, reminder.Second, discordUserId)
            : HabitMessage(reminder, discordUserId);

        var sent = await _discord.SendTrackedMessageAsync(discordUserId, message, components, cancellationToken);
        if (sent.Outcome == DeliveryOutcome.Delivered) await TrackAsync(reminder, sent);
        return sent.Outcome;
    }

    private (string, MessageComponent) HabitMessage(Reminder reminder, ulong discordUserId)
    {
        var t = BotTexts.For(reminder.Language);
        var name = reminder.HabitName;
        string intro = t.Format(reminder.Snoozed
            ? "reminder.intro.snoozed"
            : reminder.RecentCompletions >= 4
                ? "reminder.intro.great"
                : reminder.RecentCompletions >= 1
                    ? "reminder.intro.some"
                    : "reminder.intro.fresh", name);

        var message = reminder.Second
            ? t.Format("reminder.second", name)
            : t.Format("reminder.habit", intro);

        var now = _time.GetUtcNow().ToUnixTimeSeconds();
        var components = new ComponentBuilder()
            .WithButton(t.Get("reminder.done"), $"checkin:done:{reminder.HabitId}:{now}", ButtonStyle.Success)
            .WithButton(SkipLabel(t), $"checkin:skip:{reminder.HabitId}:{now}", ButtonStyle.Secondary)
            .WithButton(t.Get("reminder.snooze"), $"checkin:snooze:{reminder.HabitId}:{now}", ButtonStyle.Secondary)
            .WithButton(DiscordRemindersModule.StopButton(t, discordUserId), row: 1)
            .Build();

        return (message, components);
    }

    /// <summary>Discord allows 25 buttons per message, 5 per row.</summary>
    private const int MaxButtons = 25;
    private const int ButtonsPerRow = 5;
    private const int MaxButtonLabel = 80;

    /// <summary>Keeps the habit list well under Discord's 2000-character message limit.</summary>
    private const int MaxListLength = 1500;

    private (string, MessageComponent) RoutineMessage(Texts t, string routineName, IReadOnlyList<RoutineHabit> pending, bool second,
        ulong discordUserId)
    {
        var lines = new List<string>();
        var length = 0;
        foreach (var line in pending.Select(h => $"• {h.Name}"))
        {
            if (length + line.Length + 1 > MaxListLength) break;
            lines.Add(line);
            length += line.Length + 1;
        }
        if (lines.Count < pending.Count) lines.Add(t.Format("reminder.routine.more", pending.Count - lines.Count));
        var list = string.Join("\n", lines);
        var message = t.Format(second ? "reminder.routine.second" : "reminder.routine", routineName, list);

        var now = _time.GetUtcNow().ToUnixTimeSeconds();
        var components = new ComponentBuilder();
        var count = 0;
        foreach (var (habit, i) in pending.Take(MaxButtons - 1).Select((h, i) => (h, i)))
        {
            var label = t.Format("reminder.routine.done-button", habit.Name);
            if (label.Length > MaxButtonLabel) label = label[..(MaxButtonLabel - 1)] + "…";
            components.WithButton(label, $"checkin:done:{habit.Id}:{now}", ButtonStyle.Success, row: i / ButtonsPerRow);
            count++;
        }
        components.WithButton(DiscordRemindersModule.StopButton(t, discordUserId),
            Math.Min((count + ButtonsPerRow - 1) / ButtonsPerRow, MaxButtons / ButtonsPerRow - 1));

        return (message, components.Build());
    }

    /// <summary>Remembers the sent message; for a second reminder, deletes (or else closes) and forgets the earlier ones.</summary>
    private async Task TrackAsync(Reminder reminder, SentDm sent)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
            int? habitId = reminder.PendingHabits is null ? reminder.HabitId : null;
            int? routineId = reminder.PendingHabits is null ? null : reminder.HabitId;

            var superseded = reminder.Second
                ? await habits.GetReminderMessagesAsync(habitId, routineId, reminder.Day)
                : [];
            await habits.AddReminderMessageAsync(new ReminderMessage
            {
                UserId = reminder.UserId,
                HabitId = habitId,
                RoutineId = routineId,
                Date = reminder.Day,
                ChannelId = sent.ChannelId,
                MessageId = sent.MessageId,
            });

            foreach (var old in superseded)
            {
                if (!await _discord.DeleteMessageAsync(old.ChannelId, old.MessageId))
                    await _discord.CloseMessageAsync(old.ChannelId, old.MessageId, ClosedLine(BotTexts.For(reminder.Language)));
                await habits.DeleteReminderMessageAsync(old.Id);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not track the Discord reminder for {HabitId} of user {UserId}.", reminder.HabitId, reminder.UserId);
        }
    }
}
