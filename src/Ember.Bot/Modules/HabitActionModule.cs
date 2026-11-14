using Discord;
using Ember.Core.Localization;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles all post-select-menu button interactions and modals for habit management.
/// Custom ID patterns:
///   habitaction:checkin:done:{habitId}
///   habitaction:checkin:skip:{habitId}
///   habitaction:delete:confirm:{habitId}
///   habitaction:delete:cancel
///   habitaction:edit:rename:{habitId}
///   habitaction:pause:{habitId}:{duration}   (today | 3days | 1week | resume)
///   habitaction:freq:{habitId}:daily
///   habit:grace:{days}
///   habit:streaks:{on|off}  (sets the account's ShowStreaks and re-renders the /habit streak reply)
///   tip:streaks:{on|off}  (answers the one-time streaks question: sets ShowStreaks and drops the buttons)
///   habit:add:modal  (modal submit)
///   habit:rename:modal:{habitId}  (modal submit)
/// </summary>
public class HabitActionModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;
    private readonly IConfiguration _config;

    public HabitActionModule(HabitService habits, IConfiguration config)
    {
        _habits = habits;
        _config = config;
    }

    // ── habit:add:modal ───────────────────────────────────────────────────────

    [ModalInteraction("habit:add:modal")]
    public async Task OnAddModalAsync(HabitAddModal modal)
    {
        var name = modal.HabitName.Trim();
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (string.IsNullOrWhiteSpace(name))
        {
            await RespondAsync(t.Get("habit.add.empty"), ephemeral: true);
            return;
        }

        Habit habit;
        try
        {
            habit = await _habits.AddHabitAsync(Context.User.Id, name, reminderTime: null);
        }
        catch (ConsentRequiredException)
        {
            await ConsentModule.RespondWithPromptAsync(Context, _config, _habits);
            return;
        }
        catch (HabitLimitReachedException)
        {
            await RespondAsync(t.Format("habit.limit", HabitService.MaxHabitsPerUser), ephemeral: true);
            return;
        }
        var hasTimezone = await _habits.HasTimezoneSetAsync(Context.User.Id);

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle(t.Get("habit.add.started.title"))
            .WithDescription(t.Format("habit.add.started.body", habit.Name))
            .WithFooter(t.Get("habit.add.started.footer"))
            .Build();

        ComponentBuilder components;

        if (!hasTimezone)
        {
            components = new ComponentBuilder()
                .WithButton(t.Get("common.timezone-first"), $"onboard:timezone:{habit.Id}", ButtonStyle.Primary, new Emoji("🌍"))
                .WithButton(t.Get("common.skip-for-now"), $"reminder:skip:{habit.Id}", ButtonStyle.Secondary);
        }
        else
        {
            components = new ComponentBuilder()
                .WithButton(t.Get("common.set-reminder"), $"reminder:set:{habit.Id}", ButtonStyle.Primary, new Emoji("⏰"))
                .WithButton(t.Get("common.not-now"), $"reminder:skip:{habit.Id}", ButtonStyle.Secondary);
        }

        components.WithButton(t.Get("common.days-and-times"), $"freq:menu:{habit.Id}", ButtonStyle.Secondary, new Emoji("📅"), row: 1);
        await RespondAsync(embed: embed, components: components.Build(), ephemeral: true);

        // DM confirmation / onboarding
        var allHabits = await _habits.GetHabitsAsync(Context.User.Id);
        if (allHabits.Count == 1)
        {
            try
            {
                var dm = await Context.User.CreateDMChannelAsync();
                var dmEmbed = new EmbedBuilder()
                    .WithColor(0xE8873A)
                    .WithTitle(t.Get("habit.welcome.title"))
                    .WithDescription(t.Format("habit.welcome.body", habit.Name))
                    .WithFooter(t.Get("habit.welcome.footer"))
                    .Build();
                await dm.SendMessageAsync(embed: dmEmbed);
            }
            catch { /* DMs disabled */ }
        }

        await AskStreaksOnceAsync(Context.Interaction, _habits, t);
    }

    // ── habitaction:checkin:done:{habitId} ────────────────────────────────────

    [ComponentInteraction("habitaction:checkin:done:*")]
    public async Task OnCheckinDoneAsync(string habitIdStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(t); return; }

        var guildId = Context.Guild?.Id;
        var today = await _habits.GetLocalTodayAsync(Context.User.Id);
        if (await _habits.AddCheckInAsync(Context.User.Id, habitId, today, guildId) != DayEditResult.Saved)
        {
            await NotFoundAsync(t);
            return;
        }

        var text = HabitModule.CheckInText(t, await _habits.GetHabitAsync(Context.User.Id, habitId), today, t.Get("common.logged-today"));
        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = text;
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habitaction:checkin:skip:{habitId} ────────────────────────────────────

    [ComponentInteraction("habitaction:checkin:skip:*")]
    public async Task OnCheckinSkipAsync(string habitIdStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(t); return; }

        var guildId = Context.Guild?.Id;
        var today = await _habits.GetLocalTodayAsync(Context.User.Id);
        if (await _habits.CheckInAsync(Context.User.Id, habitId, today, completed: false, guildId) != DayEditResult.Saved)
        {
            await NotFoundAsync(t);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Get("common.skipped-today");
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habitaction:delete:confirm:{habitId} ──────────────────────────────────

    [ComponentInteraction("habitaction:delete:confirm:*")]
    public async Task OnDeleteConfirmAsync(string habitIdStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(t); return; }

        var deleted = await _habits.DeleteHabitAsync(Context.User.Id, habitId);

        if (!deleted) { await NotFoundAsync(t); return; }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Get("habit.delete.done");
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habitaction:delete:cancel ─────────────────────────────────────────────

    [ComponentInteraction("habitaction:delete:cancel")]
    public async Task OnDeleteCancelAsync()
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Get("habit.delete.cancelled");
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habitaction:edit:rename:{habitId} ─────────────────────────────────────

    [ComponentInteraction("habitaction:edit:rename:*")]
    public async Task OnEditRenameAsync(string habitIdStr)
    {
        var sourceMessageId = ((SocketMessageComponent)Context.Interaction).Message.Id;
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        var modal = new ModalBuilder()
            .WithTitle(t.Get("habit.rename.modal.title"))
            .WithCustomId($"habit:rename:modal:{habitIdStr}:{sourceMessageId}")
            .AddTextInput(t.Get("habit.rename.modal.label"), "habit_name",
                minLength: 1, maxLength: 100, required: true)
            .Build();

        await RespondWithModalAsync(modal);
        try { await DeleteOriginalResponseAsync(); } catch { /* ignore */ }
    }

    // ── habit:rename:modal:{habitId}:{sourceMessageId} ────────────────────────

    [ModalInteraction("habit:rename:modal:*:*")]
    public async Task OnRenameModalAsync(string habitIdStr, string _, HabitRenameModal modal)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(t); return; }

        var name = modal.HabitName.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            await RespondAsync(t.Get("habit.rename.empty"), ephemeral: true);
            return;
        }

        var habit = await _habits.EditHabitAsync(Context.User.Id, habitId, newName: name, newReminderTime: null, clearReminder: false);

        if (habit is null) { await NotFoundAsync(t); return; }

        var embed = new EmbedBuilder()
            .WithColor(0xF4845F)
            .WithTitle(t.Get("habit.rename.done.title"))
            .WithDescription(t.Format("habit.rename.done.body", habit.Name))
            .Build();

        await RespondAsync(embed: embed, ephemeral: true);
    }

    // ── habitaction:pause:{habitId}:{duration} ────────────────────────────────

    [ComponentInteraction("habitaction:pause:*:*")]
    public async Task OnPauseAsync(string habitIdStr, string duration)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(t); return; }

        var today = await _habits.GetLocalTodayAsync(Context.User.Id);
        DateOnly? pausedUntil = duration switch
        {
            "today"  => (DateOnly?)today,
            "3days"  => today.AddDays(2),
            "1week"  => today.AddDays(6),
            "resume" => null,
            _        => today.AddDays(6)
        };

        var habit = await _habits.PauseHabitAsync(Context.User.Id, habitId, pausedUntil);

        if (habit is null) { await NotFoundAsync(t); return; }

        string message = duration == "resume"
            ? t.Format("habit.pause.resumed", habit.Name)
            : t.Format("habit.pause.paused", habit.Name, pausedUntil?.ToString(t.Get("date.month-day"), t.Culture));

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = message;
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habitaction:freq:{habitId}:daily ─────────────────────────────────────

    [ComponentInteraction("habitaction:freq:*:*")]
    public async Task OnFreqDailyAsync(string habitIdStr, string freqType)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(t); return; }
        if (freqType != "daily") { await BadIdAsync(t); return; }

        var current = await _habits.GetHabitAsync(Context.User.Id, habitId);
        var habit = current is null ? null
            : await _habits.SetScheduleAsync(Context.User.Id, habitId, FrequencyType.Daily, null, null, current.TimesPerDay);

        if (habit is null) { await NotFoundAsync(t); return; }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Format("habit.frequency.daily-set", habit.Name);
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habit:grace:{days} ────────────────────────────────────────────────────

    [ComponentInteraction("habit:grace:*")]
    public async Task OnGraceAsync(string daysStr)
    {
        if (!int.TryParse(daysStr, out var days) || days < 0 || days > 3)
        {
            await RespondAsync((await BotTexts.ForAsync(_habits, Context.Interaction)).Get("habit.grace.invalid"), ephemeral: true);
            return;
        }

        await _habits.SetGraceDaysAsync(Context.User.Id, days, Languages.FromLocale(Context.Interaction.UserLocale));
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Format("habit.grace.set", days, t.Get($"habit.grace.desc.{days}"));
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habit:streaks:{on|off} ────────────────────────────────────────────────

    [ComponentInteraction("habit:streaks:*")]
    public async Task OnStreaksAsync(string state)
    {
        if (state is not ("on" or "off")) { await BadIdAsync(await BotTexts.ForAsync(_habits, Context.Interaction)); return; }

        await _habits.SetShowStreaksAsync(Context.User.Id, state == "on", Languages.FromLocale(Context.Interaction.UserLocale));
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        var (pages, toggle) = await HabitModule.RenderStatsAsync(t, _habits, Context.User.Id);

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = pages.Count == 0 ? t.Get("habit.stats.none") : null;
                m.Embeds     = pages.Take(1).ToArray();
                m.Components = pages.Count == 0 ? new ComponentBuilder().Build() : toggle;
            });
        foreach (var page in pages.Skip(1))
            await FollowupAsync(embed: page, ephemeral: true);
    }

    // ── tip:streaks:{on|off} ──────────────────────────────────────────────────

    [ComponentInteraction("tip:streaks:*")]
    public async Task OnStreaksTipAsync(string state)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (state is not ("on" or "off")) { await BadIdAsync(t); return; }

        await _habits.SetShowStreaksAsync(Context.User.Id, state == "on", Languages.FromLocale(Context.Interaction.UserLocale));
        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Get(state == "on" ? "habit.streaks-tip.on" : "habit.streaks-tip.off");
                m.Components = new ComponentBuilder().Build();
            });
    }

    /// <summary>
    /// Asks the one-time streaks question as an ephemeral follow-up when <see cref="HabitService.NeedsStreaksQuestionAsync(ulong)"/>
    /// says the account needs it; the answer comes back as <c>tip:streaks:{on|off}</c>.
    /// </summary>
    internal static async Task AskStreaksOnceAsync(IDiscordInteraction interaction, HabitService habits, Texts t)
    {
        if (!await habits.NeedsStreaksQuestionAsync(interaction.User.Id)) return;

        var buttons = new ComponentBuilder()
            .WithButton(t.Get("habit.streaks-tip.show"), "tip:streaks:on", ButtonStyle.Primary)
            .WithButton(t.Get("habit.streaks-tip.not-for-me"), "tip:streaks:off", ButtonStyle.Secondary)
            .Build();
        await interaction.FollowupAsync(t.Get("habit.streaks-tip.question"), components: buttons, ephemeral: true);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task BadIdAsync(Texts t) =>
        await RespondAsync(t.Get("common.retry.dash"), ephemeral: true);

    private async Task NotFoundAsync(Texts t) =>
        await RespondAsync(t.Get("common.not-found"), ephemeral: true);
}

public class HabitAddModal : IModal
{
    public string Title => "Add a new habit";

    [InputLabel("What habit do you want to track?")]
    [ModalTextInput("habit_name", placeholder: "e.g. Morning walk, Read 10 pages, Drink water")]
    public string HabitName { get; set; } = "";
}

public class HabitRenameModal : IModal
{
    public string Title => "Rename habit";

    [InputLabel("New name")]
    [ModalTextInput("habit_name")]
    public string HabitName { get; set; } = "";
}
