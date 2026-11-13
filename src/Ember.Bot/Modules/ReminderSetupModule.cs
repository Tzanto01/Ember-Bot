using System.Globalization;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Services;
using Ember.Core.Localization;
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
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!await _habits.HasTimezoneSetAsync(Context.User.Id))
        {
            await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
            {
                m.Content    = t.Get("reminder.need-timezone");
                m.Embed      = null;
                m.Components = new ComponentBuilder()
                    .WithButton(t.Get("reminder.set-timezone"), $"onboard:timezone:{habitIdStr}", ButtonStyle.Primary, new Emoji("🌍"))
                    .WithButton(t.Get("reminder.on-utc"), $"reminder:time:{habitIdStr}", ButtonStyle.Secondary)
                    .WithButton(t.Get("common.not-now"), $"reminder:skip:{habitIdStr}", ButtonStyle.Secondary)
                    .Build();
            });
            return;
        }

        await OpenTimeModalAsync(t, habitIdStr);
    }

    /// <summary>"I'm on UTC": the time modal without asking for a timezone first.</summary>
    [ComponentInteraction("reminder:time:*")]
    public async Task OnKeepUtcAsync(string habitIdStr) => await OpenTimeModalAsync(await BotTexts.ForAsync(_habits, Context.Interaction), habitIdStr);

    private async Task OpenTimeModalAsync(Texts t, string habitIdStr)
    {
        // Embed the source message ID in the modal custom ID so the modal
        // handler can update the original button message after confirming.
        var sourceMessageId = ((SocketMessageComponent)Context.Interaction).Message.Id;

        var modal = new ModalBuilder()
            .WithTitle(t.Get("reminder.modal.title"))
            .WithCustomId($"reminder:modal:{habitIdStr}:{sourceMessageId}")
            .AddTextInput(t.Get("reminder.modal.label"), "reminder_time",
                placeholder: t.Get("reminder.modal.placeholder"),
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
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        var replaced = int.TryParse(habitIdStr, out var id) ? (await _habits.GetHabitAsync(Context.User.Id, id))?.ReminderTimes.ToList() ?? [] : [];
        var habit = await SetPresetReminderAsync(_habits, Context.User.Id, habitIdStr, $"{hour}:{minute}");
        if (habit is null)
        {
            await RespondAsync(t.Get("reminder.not-found"), ephemeral: true);
            return;
        }

        var discordNote = await DiscordRemindersNoteAsync(t, _habits, Context.User.Id);
        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content = t.Get("reminder.set.title") + " " + t.Format("reminder.set.line", habit.Name, ScheduleText(t, habit), $"{habit.ReminderTime:HH\\:mm}")
                    + " " + t.Get("reminder.set.got-this") + ReplacedText(t, replaced) + discordNote;
                m.Embed = null;
                m.Components = new ComponentBuilder().Build();
            });
    }

    /// <summary>
    /// For a reminder set from Discord, which keeps one time: a note naming the earlier times it replaced, when there were several.
    /// </summary>
    internal static string ReplacedText(Texts t, IReadOnlyList<TimeOnly> replaced)
        => replaced.Count > 1
            ? "\n" + t.Format("reminder.replaced", HabitModule.FormatTimes(replaced))
            : "";

    /// <summary>
    /// For a reminder time set through the bot: turns Discord reminders on when the user never answered the ask
    /// (<see cref="HabitService.DefaultDiscordRemindersOnAsync"/>), and returns the note that they are off when the user said no.
    /// </summary>
    internal static async Task<string> DiscordRemindersNoteAsync(Texts t, HabitService habits, ulong userId)
        => await habits.DefaultDiscordRemindersOnAsync(userId) ? "" : DiscordRemindersModule.OffText(t);

    /// <summary>
    /// "every day", "on Mon, Wed" for a habit on set weekdays, or for a weekly habit the days without a check-in until the
    /// week's target is met.
    /// </summary>
    internal static string ScheduleText(Texts t, Habit habit)
        => habit.FrequencyType switch
        {
            FrequencyType.Weekdays => t.Format("reminder.schedule.weekdays", string.Join(", ", ScheduleDayNames.ToNames(habit.Days.GetValueOrDefault())
                .Select(n => HabitModule.DayName(t, n)))),
            FrequencyType.Weekly => t.Plural("reminder.schedule.weekly", habit.WeeklyTarget ?? 3),
            _ => t.Get("reminder.schedule.daily"),
        };

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
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content = t.Get("reminder.skipped");
                m.Embed = null;
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── "Remove reminder" button (from /habit edit) ───────────────────────────

    [ComponentInteraction("reminder:clear:*")]
    public async Task OnClearReminderAsync(string habitIdStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId))
        {
            await RespondAsync(t.Get("common.retry.period"), ephemeral: true);
            return;
        }

        var habit = await _habits.EditHabitAsync(Context.User.Id, habitId, newName: null, newReminderTime: null, clearReminder: true);

        if (habit is null)
        {
            await RespondAsync(t.Get("reminder.not-found"), ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content = t.Format("reminder.removed", habit.Name);
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── "Cancel" button (from /habit edit) ───────────────────────────────────

    [ComponentInteraction("reminder:cancel:*")]
    public async Task OnCancelEditAsync(string habitIdStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content = t.Get("reminder.no-changes");
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── Modal submit ──────────────────────────────────────────────────────────

    [ModalInteraction("reminder:modal:*:*")]
    public async Task OnReminderModalAsync(string habitIdStr, string sourceMessageIdStr, ReminderModal modal)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId))
        {
            await RespondAsync(t.Get("common.retry.period"), ephemeral: true);
            return;
        }

        if (!TryParseTime(modal.ReminderTime, out var parsed))
        {
            await RespondAsync(t.Get("reminder.bad-time"),
                components: new ComponentBuilder().WithButton(t.Get("reminder.try-again"), $"reminder:set:{habitId}", ButtonStyle.Primary, new Emoji("⏰")).Build(),
                ephemeral: true);
            return;
        }

        var replaced = (await _habits.GetHabitAsync(Context.User.Id, habitId))?.ReminderTimes.ToList() ?? [];
        var habit = await _habits.EditHabitAsync(Context.User.Id, habitId, newName: null, parsed, clearReminder: false);

        if (habit is null)
        {
            await RespondAsync(t.Get("reminder.not-found"), ephemeral: true);
            return;
        }

        var discordNote = await DiscordRemindersNoteAsync(t, _habits, Context.User.Id);
        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle(t.Get("reminder.set.title"))
            .WithDescription(t.Format("reminder.set.line", habit.Name, ScheduleText(t, habit), $"{parsed:HH\\:mm}")
                + ReplacedText(t, replaced) + discordNote)
            .WithFooter(t.Get("reminder.set.footer"))
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
