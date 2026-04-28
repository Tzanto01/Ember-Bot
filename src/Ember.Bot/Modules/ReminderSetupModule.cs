using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

public class ReminderSetupModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public ReminderSetupModule(HabitService habits)
    {
        _habits = habits;
    }

    // ── "Set a reminder" button ───────────────────────────────────────────────

    [ComponentInteraction("reminder:set:*")]
    public async Task OnSetReminderAsync(string habitIdStr)
    {
        // Embed the source message ID in the modal custom ID so the modal
        // handler can update the original button message after confirming.
        var sourceMessageId = ((SocketMessageComponent)Context.Interaction).Message.Id;

        var modal = new ModalBuilder()
            .WithTitle("Set a daily reminder")
            .WithCustomId($"reminder:modal:{habitIdStr}:{sourceMessageId}")
            .AddTextInput("What time? (HH:mm, your local time)", "reminder_time",
                placeholder: "e.g. 09:00 or 21:30",
                minLength: 4, maxLength: 5, required: true)
            .Build();

        await RespondWithModalAsync(modal);

        // Strip the buttons from the original message so it can't be clicked again.
        // DeleteOriginalResponseAsync works after RespondWithModalAsync for component interactions.
        try { await DeleteOriginalResponseAsync(); } catch { /* ignore */ }
    }

    // ── "Not now" button ──────────────────────────────────────────────────────

    [ComponentInteraction("reminder:skip:*")]
    public async Task OnSkipReminderAsync(string habitIdStr)
    {
        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content = "No problem — you can always add one later with `/habit edit`. 💙";
                m.Embed = null;
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── "Remove reminder" button (from /habit edit) ───────────────────────────

    [ComponentInteraction("reminder:clear:*")]
    public async Task OnClearReminderAsync(string habitIdStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId))
        {
            await RespondAsync("Something went wrong. Please try again.", ephemeral: true);
            return;
        }

        var habit = await _habits.EditHabitAsync(Context.User.Id, habitId, newName: null, newReminderTime: null, clearReminder: true);

        if (habit is null)
        {
            await RespondAsync("Couldn't find that habit. It may have been deleted.", ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content = $"Reminder removed from **{habit.Name}**. 💙";
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── "Cancel" button (from /habit edit) ───────────────────────────────────

    [ComponentInteraction("reminder:cancel:*")]
    public async Task OnCancelEditAsync(string habitIdStr)
    {
        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content = "No changes made.";
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── Modal submit ──────────────────────────────────────────────────────────

    [ModalInteraction("reminder:modal:*:*")]
    public async Task OnReminderModalAsync(string habitIdStr, string sourceMessageIdStr, ReminderModal modal)
    {
        if (!int.TryParse(habitIdStr, out var habitId))
        {
            await RespondAsync("Something went wrong. Please try again.", ephemeral: true);
            return;
        }

        if (!TimeOnly.TryParseExact(modal.ReminderTime.Trim(), ["HH:mm", "H:mm"], out var parsed))
        {
            await RespondAsync("Couldn't parse that time. Use HH:mm format, e.g. `09:00`.", ephemeral: true);
            return;
        }

        var habit = await _habits.EditHabitAsync(Context.User.Id, habitId, newName: null, parsed, clearReminder: false);

        if (habit is null)
        {
            await RespondAsync("Couldn't find that habit. It may have been deleted.", ephemeral: true);
            return;
        }

        // Build a Discord timestamp for the reminder time
        var tz    = await _habits.GetUserTzAsync(Context.User.Id);
        var utc   = TimezoneHelper.ToUtc(parsed, tz);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var utcDt = DateTime.SpecifyKind(today.ToDateTime(utc), DateTimeKind.Utc);
        var unix  = new DateTimeOffset(utcDt).ToUnixTimeSeconds();

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle("⏰ Reminder set!")
            .WithDescription($"I'll remind you to **{habit.Name}** every day at <t:{unix}:t>.")
            .WithFooter("You've got this. One day at a time.")
            .Build();

        await RespondAsync(embed: embed, ephemeral: true);
    }
}

public class ReminderModal : IModal
{
    public string Title => "Set a daily reminder";

    [InputLabel("What time? (HH:mm, your local time)")]
    [ModalTextInput("reminder_time", placeholder: "e.g. 09:00 or 21:30")]
    public string ReminderTime { get; set; } = "";
}
