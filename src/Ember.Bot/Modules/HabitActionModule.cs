using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Models;
using Ember.Bot.Services;

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
///   habit:add:modal  (modal submit)
///   habit:rename:modal:{habitId}  (modal submit)
/// </summary>
public class HabitActionModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public HabitActionModule(HabitService habits)
    {
        _habits = habits;
    }

    // ── habit:add:modal ───────────────────────────────────────────────────────

    [ModalInteraction("habit:add:modal")]
    public async Task OnAddModalAsync(HabitAddModal modal)
    {
        var name = modal.HabitName.Trim();

        if (string.IsNullOrWhiteSpace(name))
        {
            await RespondAsync("Habit name can't be empty.", ephemeral: true);
            return;
        }

        var habit = await _habits.AddHabitAsync(Context.User.Id, name, reminderTime: null);
        var hasTimezone = await _habits.HasTimezoneSetAsync(Context.User.Id);

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle("Habit started")
            .WithDescription($"**{habit.Name}** is now being tracked.\nSet a reminder so I can nudge you at the right time.")
            .WithFooter("You've got this.")
            .Build();

        ComponentBuilder components;

        if (!hasTimezone)
        {
            components = new ComponentBuilder()
                .WithButton("Set my timezone first", $"onboard:timezone:{habit.Id}", ButtonStyle.Primary, new Emoji("🌍"))
                .WithButton("Skip for now", $"reminder:skip:{habit.Id}", ButtonStyle.Secondary);
        }
        else
        {
            components = new ComponentBuilder()
                .WithButton("Set a reminder", $"reminder:set:{habit.Id}", ButtonStyle.Primary, new Emoji("⏰"))
                .WithButton("Not now", $"reminder:skip:{habit.Id}", ButtonStyle.Secondary);
        }

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
                    .WithTitle("🔥 Welcome to Ember!")
                    .WithDescription(
                        $"You're now tracking **{habit.Name}**.\n\n" +
                        "Here's how to get started:\n" +
                        "• **Check in daily** with `/habit checkin`\n" +
                        "• **Set a reminder** so I nudge you at the right time\n" +
                        "• **No guilt** — missing days is fine, progress counts")
                    .WithFooter("Progress over perfection. I'm rooting for you. 💙")
                    .Build();
                await dm.SendMessageAsync(embed: dmEmbed);
            }
            catch { /* DMs disabled */ }
        }
        else
        {
            try
            {
                var dm = await Context.User.CreateDMChannelAsync();
                var dmEmbed = new EmbedBuilder()
                    .WithColor(0xE8873A)
                    .WithTitle("New habit started")
                    .WithDescription(
                        $"**{habit.Name}** is now being tracked.\n\n" +
                        "Use </habit checkin:0> whenever you're ready to log it.")
                    .WithFooter("I'll remind you when it's time.")
                    .Build();
                await dm.SendMessageAsync(embed: dmEmbed);
            }
            catch { /* DMs disabled */ }
        }
    }

    // ── habitaction:checkin:done:{habitId} ────────────────────────────────────

    [ComponentInteraction("habitaction:checkin:done:*")]
    public async Task OnCheckinDoneAsync(string habitIdStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(); return; }

        var guildId = Context.Guild?.Id;
        var log = await _habits.CheckInAsync(Context.User.Id, habitId, completed: true, guildId);

        if (log is null) { await NotFoundAsync(); return; }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = "Logged! Great work today. ✅";
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habitaction:checkin:skip:{habitId} ────────────────────────────────────

    [ComponentInteraction("habitaction:checkin:skip:*")]
    public async Task OnCheckinSkipAsync(string habitIdStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(); return; }

        var guildId = Context.Guild?.Id;
        var log = await _habits.CheckInAsync(Context.User.Id, habitId, completed: false, guildId);

        if (log is null) { await NotFoundAsync(); return; }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = "No worries — noted. Tomorrow's a fresh start. 💙";
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habitaction:delete:confirm:{habitId} ──────────────────────────────────

    [ComponentInteraction("habitaction:delete:confirm:*")]
    public async Task OnDeleteConfirmAsync(string habitIdStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(); return; }

        var deleted = await _habits.DeleteHabitAsync(Context.User.Id, habitId);

        if (!deleted) { await NotFoundAsync(); return; }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = "Habit removed. No judgement — you can always start fresh with `/habit add`. 💙";
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habitaction:delete:cancel ─────────────────────────────────────────────

    [ComponentInteraction("habitaction:delete:cancel")]
    public async Task OnDeleteCancelAsync()
    {
        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = "Cancelled — nothing was deleted.";
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habitaction:edit:rename:{habitId} ─────────────────────────────────────

    [ComponentInteraction("habitaction:edit:rename:*")]
    public async Task OnEditRenameAsync(string habitIdStr)
    {
        var sourceMessageId = ((SocketMessageComponent)Context.Interaction).Message.Id;

        var modal = new ModalBuilder()
            .WithTitle("Rename habit")
            .WithCustomId($"habit:rename:modal:{habitIdStr}:{sourceMessageId}")
            .AddTextInput("New name", "habit_name",
                minLength: 1, maxLength: 100, required: true)
            .Build();

        await RespondWithModalAsync(modal);
        try { await DeleteOriginalResponseAsync(); } catch { /* ignore */ }
    }

    // ── habit:rename:modal:{habitId}:{sourceMessageId} ────────────────────────

    [ModalInteraction("habit:rename:modal:*:*")]
    public async Task OnRenameModalAsync(string habitIdStr, string _, HabitRenameModal modal)
    {
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(); return; }

        var name = modal.HabitName.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            await RespondAsync("Name can't be empty.", ephemeral: true);
            return;
        }

        var habit = await _habits.EditHabitAsync(Context.User.Id, habitId, newName: name, newReminderTime: null, clearReminder: false);

        if (habit is null) { await NotFoundAsync(); return; }

        var embed = new EmbedBuilder()
            .WithColor(0xF4845F)
            .WithTitle("Habit renamed")
            .WithDescription($"Now tracking **{habit.Name}**.")
            .Build();

        await RespondAsync(embed: embed, ephemeral: true);
    }

    // ── habitaction:pause:{habitId}:{duration} ────────────────────────────────

    [ComponentInteraction("habitaction:pause:*:*")]
    public async Task OnPauseAsync(string habitIdStr, string duration)
    {
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(); return; }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        DateOnly? pausedUntil = duration switch
        {
            "today"  => (DateOnly?)today,
            "3days"  => today.AddDays(2),
            "1week"  => today.AddDays(6),
            "resume" => null,
            _        => today.AddDays(6)
        };

        var habit = await _habits.PauseHabitAsync(Context.User.Id, habitId, pausedUntil);

        if (habit is null) { await NotFoundAsync(); return; }

        string message = duration == "resume"
            ? $"**{habit.Name}** is back on. Welcome back! 🔥"
            : $"**{habit.Name}** is paused until **{pausedUntil:MMM d}**.\n" +
              "Reminders are off and missed days won't count against your streak. Rest well. 💙";

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
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(); return; }
        if (freqType != "daily") { await BadIdAsync(); return; }

        var habit = await _habits.SetFrequencyAsync(Context.User.Id, habitId, FrequencyType.Daily, null);

        if (habit is null) { await NotFoundAsync(); return; }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = $"**{habit.Name}** is now daily — check in every day.";
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── habit:grace:{days} ────────────────────────────────────────────────────

    [ComponentInteraction("habit:grace:*")]
    public async Task OnGraceAsync(string daysStr)
    {
        if (!int.TryParse(daysStr, out var days) || days < 0 || days > 3)
        {
            await RespondAsync("Invalid value.", ephemeral: true);
            return;
        }

        await _habits.SetGraceDaysAsync(Context.User.Id, days);

        var description = days switch
        {
            0 => "Strict mode — streaks require a check-in every single day.",
            1 => "1 flex day per week — one missed day won't break your streak.",
            2 => "2 flex days per week — life happens, your streak is safe.",
            3 => "3 flex days per week — maximum flexibility.",
            _ => ""
        };

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = $"Flex days set to **{days}/week**. {description}";
                m.Components = new ComponentBuilder().Build();
            });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task BadIdAsync() =>
        await RespondAsync("Something went wrong — please try again.", ephemeral: true);

    private async Task NotFoundAsync() =>
        await RespondAsync("Couldn't find that habit.", ephemeral: true);
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
