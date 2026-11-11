using System.Globalization;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Services;
using Ember.Core.Models;
using Ember.Core.Services;

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
        if (!await _habits.HasTimezoneSetAsync(Context.User.Id))
        {
            await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
            {
                m.Content    = "Reminders follow your local time, so which timezone are you in? 🌍";
                m.Embed      = null;
                m.Components = new ComponentBuilder()
                    .WithButton("Set my timezone", $"onboard:timezone:{habitIdStr}", ButtonStyle.Primary, new Emoji("🌍"))
                    .WithButton("I'm on UTC", $"reminder:time:{habitIdStr}", ButtonStyle.Secondary)
                    .WithButton("Not now", $"reminder:skip:{habitIdStr}", ButtonStyle.Secondary)
                    .Build();
            });
            return;
        }

        await OpenTimeModalAsync(habitIdStr);
    }

    /// <summary>"I'm on UTC": the time modal without asking for a timezone first.</summary>
    [ComponentInteraction("reminder:time:*")]
    public async Task OnKeepUtcAsync(string habitIdStr) => await OpenTimeModalAsync(habitIdStr);

    private async Task OpenTimeModalAsync(string habitIdStr)
    {
        // Embed the source message ID in the modal custom ID so the modal
        // handler can update the original button message after confirming.
        var sourceMessageId = ((SocketMessageComponent)Context.Interaction).Message.Id;

        var modal = new ModalBuilder()
            .WithTitle("Set a daily reminder")
            .WithCustomId($"reminder:modal:{habitIdStr}:{sourceMessageId}")
            .AddTextInput("What time? (your local time)", "reminder_time",
                placeholder: "e.g. 09:00, 21:30 or 9pm",
                minLength: 3, maxLength: 8, required: true)
            .Build();

        await RespondWithModalAsync(modal);

        // Strip the buttons from the original message so it can't be clicked again.
        // DeleteOriginalResponseAsync works after RespondWithModalAsync for component interactions.
        try { await DeleteOriginalResponseAsync(); } catch { /* ignore */ }
    }

    // ── "Remind me at HH:mm" button (from /habit template) ────────────────────

    [ComponentInteraction("reminder:preset:*:*:*")]
    public async Task OnPresetReminderAsync(string habitIdStr, string hour, string minute)
    {
        var habit = await SetPresetReminderAsync(_habits, Context.User.Id, habitIdStr, $"{hour}:{minute}");
        if (habit is null)
        {
            await RespondAsync("Couldn't find that habit. It may have been deleted.", ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content = $"⏰ Reminder set! I'll remind you to **{habit.Name}** {ScheduleText(habit)} at **{habit.ReminderTime:HH\\:mm}** your time. You've got this.";
                m.Embed = null;
                m.Components = new ComponentBuilder().Build();
            });
    }

    /// <summary>"every day", or "on Mon, Wed" for a habit on set weekdays (weekly habits get a reminder every day).</summary>
    internal static string ScheduleText(Habit habit)
        => habit.FrequencyType == FrequencyType.Weekdays
            ? "on " + string.Join(", ", ScheduleDayNames.ToNames(habit.Days.GetValueOrDefault())
                .Select(n => char.ToUpperInvariant(n[0]) + n[1..]))
            : "every day";

    /// <summary>A reminder time typed as 24-hour (<c>21:30</c>, <c>9:05</c>) or 12-hour (<c>9pm</c>, <c>9:30 PM</c>) clock time.</summary>
    internal static bool TryParseTime(string input, out TimeOnly time)
        => TimeOnly.TryParseExact(input.Trim().ToUpperInvariant(), ["H:mm", "h:mmtt", "h:mm tt", "htt", "h tt"],
            CultureInfo.InvariantCulture, DateTimeStyles.None, out time);

    /// <summary>Sets a preset reminder time on one of the clicking user's own habits; null if the habit isn't theirs or the input is malformed.</summary>
    internal static async Task<Ember.Core.Models.Habit?> SetPresetReminderAsync(HabitService habits, ulong userId, string habitIdStr, string time)
    {
        if (!int.TryParse(habitIdStr, out var habitId) || !TimeOnly.TryParseExact(time, "HH:mm", out var reminderTime))
            return null;

        return await habits.EditHabitAsync(userId, habitId, newName: null, reminderTime, clearReminder: false);
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

        if (!TryParseTime(modal.ReminderTime, out var parsed))
        {
            await RespondAsync("I couldn't read that time. Try something like `09:00`, `21:30` or `9pm`. 💙",
                components: new ComponentBuilder().WithButton("Try again", $"reminder:set:{habitId}", ButtonStyle.Primary, new Emoji("⏰")).Build(),
                ephemeral: true);
            return;
        }

        var habit = await _habits.EditHabitAsync(Context.User.Id, habitId, newName: null, parsed, clearReminder: false);

        if (habit is null)
        {
            await RespondAsync("Couldn't find that habit. It may have been deleted.", ephemeral: true);
            return;
        }

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle("⏰ Reminder set!")
            .WithDescription($"I'll remind you to **{habit.Name}** {ScheduleText(habit)} at **{parsed:HH\\:mm}** your time.")
            .WithFooter("You've got this. One day at a time.")
            .Build();

        await RespondAsync(embed: embed, ephemeral: true);
    }
}

public class ReminderModal : IModal
{
    public string Title => "Set a daily reminder";

    [InputLabel("What time? (your local time)")]
    [ModalTextInput("reminder_time", placeholder: "e.g. 09:00, 21:30 or 9pm")]
    public string ReminderTime { get; set; } = "";
}
