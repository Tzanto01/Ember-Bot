using Discord;
using Discord.Interactions;
using Ember.Bot.Models;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

[Group("habit", "Track your habits")]
public class HabitModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public HabitModule(HabitService habits)
    {
        _habits = habits;
    }

    private async Task<string> FormatReminderAsync(TimeOnly? localTime)
    {
        if (!localTime.HasValue) return "None set";
        var tz    = await _habits.GetUserTzAsync(Context.User.Id);
        var utc   = TimezoneHelper.ToUtc(localTime.Value, tz);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var utcDt = DateTime.SpecifyKind(today.ToDateTime(utc), DateTimeKind.Utc);
        var unix  = new DateTimeOffset(utcDt).ToUnixTimeSeconds();
        return $"<t:{unix}:t>";
    }

    private static string FrequencyLabel(Habit h) =>
        h.FrequencyType == FrequencyType.Weekly
            ? $"{h.WeeklyTarget ?? 3}×/week"
            : "daily";

    // ── Autocomplete handler for habit_id ────────────────────────────────────

    public class HabitAutocompleteHandler : AutocompleteHandler
    {
        public override async Task<AutocompletionResult> GenerateSuggestionsAsync(
            IInteractionContext context,
            IAutocompleteInteraction autocompleteInteraction,
            IParameterInfo parameter,
            IServiceProvider services)
        {
            var habitService = (HabitService)services.GetService(typeof(HabitService))!;
            var habits = await habitService.GetHabitsAsync(context.User.Id);

            var typed = autocompleteInteraction.Data.Current.Value?.ToString() ?? "";

            var results = habits
                .Where(h => h.Name.Contains(typed, StringComparison.OrdinalIgnoreCase))
                .Take(25)
                .Select(h => new AutocompleteResult(h.Name, h.Id));

            return AutocompletionResult.FromSuccess(results);
        }
    }

    // ── /habit add ────────────────────────────────────────────────────────────

    [SlashCommand("add", "Add a new habit to track")]
    public async Task AddAsync(
        [Summary("name", "What habit do you want to track?")] string name)
    {
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

    // ── /habit template ───────────────────────────────────────────────────────

    [SlashCommand("template", "Start a habit from a pre-built template")]
    public async Task TemplateAsync()
    {
        var menu = new SelectMenuBuilder()
            .WithCustomId("habit:template:select")
            .WithPlaceholder("Choose a template…")
            .WithMinValues(1)
            .WithMaxValues(1);

        foreach (var t in HabitTemplates.All)
        {
            var freqHint = t.Frequency == HabitTemplates.FrequencyHint.Weekly
                ? $" · {t.WeeklyTarget}×/week"
                : " · daily";
            menu.AddOption(
                label: t.DisplayName,
                value: t.Key,
                description: $"{t.Description}{freqHint}");
        }

        var components = new ComponentBuilder().WithSelectMenu(menu).Build();

        await RespondAsync(
            "Pick a template — you can customise the name and reminder after:",
            components: components,
            ephemeral: true);
    }

    // ── /habit list ───────────────────────────────────────────────────────────

    [SlashCommand("list", "See all your habits and their recent progress")]
    public async Task ListAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);
        var grace  = await _habits.GetGraceDaysAsync(Context.User.Id);
        var today  = DateOnly.FromDateTime(DateTime.UtcNow);

        if (habits.Count == 0)
        {
            await RespondAsync("You don't have any habits yet. Use `/habit add` or `/habit template` to get started!", ephemeral: true);
            return;
        }

        const int pageSize = 8;
        var pages = (int)Math.Ceiling(habits.Count / (double)pageSize);

        for (int page = 0; page < pages; page++)
        {
            var slice = habits.Skip(page * pageSize).Take(pageSize).ToList();

            var embed = new EmbedBuilder()
                .WithColor(0xF4845F)
                .WithTitle(pages > 1 ? $"Your Habits (page {page + 1}/{pages})" : "Your Habits");

            foreach (var h in slice)
            {
                var checkedToday = h.Logs.Any(l => l.Date == today && l.Completed);
                var todayMark    = checkedToday ? "✅" : "⬜";
                var reminderStr  = await FormatReminderAsync(h.ReminderTime);
                var pauseStr     = h.PausedUntil.HasValue && h.PausedUntil >= today
                    ? $" · ⏸️ paused until {h.PausedUntil:MMM d}" : "";

                string progressStr;
                if (h.FrequencyType == FrequencyType.Weekly)
                {
                    var (done, target) = HabitService.WeeklyProgress(h);
                    progressStr = $"This week: **{done}/{target}** · Last 4 wks: **{HabitService.FlexibleStreak(h, 28)}/28**";
                }
                else
                {
                    var (streak, graceUsed) = HabitService.ConsecutiveStreak(h, grace);
                    var graceStr = graceUsed > 0 ? $" _(+{graceUsed} flex)_" : "";
                    progressStr = $"Streak: **{streak}** days{graceStr} · Last 7: **{HabitService.FlexibleStreak(h, 7)}/7**";
                }

                embed.AddField(
                    $"{todayMark} {h.Name}{pauseStr} _({FrequencyLabel(h)})_",
                    $"{progressStr}\nReminder: {reminderStr}",
                    inline: false);
            }

            embed.WithFooter("Progress over perfection.");

            if (page == 0)
                await RespondAsync(embed: embed.Build(), ephemeral: true);
            else
                await FollowupAsync(embed: embed.Build(), ephemeral: true);
        }
    }

    // ── /habit checkin ────────────────────────────────────────────────────────

    [SlashCommand("checkin", "Log today's check-in for a habit")]
    public async Task CheckInAsync(
        [Summary("habit", "Which habit?"), Autocomplete(typeof(HabitAutocompleteHandler))] int habitId,
        [Summary("completed", "Did you do it today?")] bool completed = true)
    {
        var guildId = Context.Guild?.Id;
        var log = await _habits.CheckInAsync(Context.User.Id, habitId, completed, guildId);

        if (log is null)
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        var message = completed
            ? "Nice work! Logged as done for today. ✅"
            : "No worries — logged. Tomorrow's a fresh start. 💙";

        await RespondAsync(message, ephemeral: true);
    }

    // ── /habit streak ─────────────────────────────────────────────────────────

    [SlashCommand("streak", "See your personal habit stats")]
    public async Task StreakAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);
        var grace  = await _habits.GetGraceDaysAsync(Context.User.Id);

        if (habits.Count == 0)
        {
            await RespondAsync("No habits tracked yet. Use `/habit add` to begin!", ephemeral: true);
            return;
        }

        const int pageSize = 6;
        var pages = (int)Math.Ceiling(habits.Count / (double)pageSize);

        for (int page = 0; page < pages; page++)
        {
            var slice = habits.Skip(page * pageSize).Take(pageSize).ToList();

            var embed = new EmbedBuilder()
                .WithColor(0xF4845F)
                .WithTitle(pages > 1 ? $"Your Habit Stats (page {page + 1}/{pages})" : "Your Habit Stats");

            foreach (var h in slice)
            {
                string statsText;
                if (h.FrequencyType == FrequencyType.Weekly)
                {
                    var (done, target) = HabitService.WeeklyProgress(h);
                    var total  = h.Logs.Count(l => l.Completed);
                    var last28 = HabitService.FlexibleStreak(h, 28);
                    statsText =
                        $"This week: **{done}/{target}**\n" +
                        $"Last 28 days: **{last28}/28** · Total: **{total}**";
                }
                else
                {
                    var (streak, graceUsed) = HabitService.ConsecutiveStreak(h, grace);
                    var last7  = HabitService.FlexibleStreak(h, 7);
                    var last30 = HabitService.FlexibleStreak(h, 30);
                    var best   = HabitService.BestStreak(h);
                    var total  = h.Logs.Count(l => l.Completed);
                    var graceStr = graceUsed > 0 ? $"\n_({graceUsed} flex day{(graceUsed > 1 ? "s" : "")} used)_" : "";
                    statsText =
                        $"Streak: **{streak}** days{graceStr}\n" +
                        $"Last 7: **{last7}/7** · Last 30: **{last30}/30**\n" +
                        $"Best: **{best}** · Total: **{total}**";
                }

                embed.AddField(
                    $"🔥 {h.Name} _({FrequencyLabel(h)})_",
                    statsText,
                    inline: true);
            }

            embed.WithFooter($"Flex days: {grace}/week · Every check-in counts, no matter the gap.");

            if (page == 0)
                await RespondAsync(embed: embed.Build(), ephemeral: true);
            else
                await FollowupAsync(embed: embed.Build(), ephemeral: true);
        }
    }

    // ── /habit share ──────────────────────────────────────────────────────────

    [SlashCommand("share", "Share a habit streak card publicly in this channel")]
    public async Task ShareAsync(
        [Summary("habit", "Which habit to share?"), Autocomplete(typeof(HabitAutocompleteHandler))] int habitId)
    {
        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        var grace = await _habits.GetGraceDaysAsync(Context.User.Id);

        if (habit is null)
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var from  = today.AddDays(-29);

        var completed = habit.Logs
            .Where(l => l.Completed && l.Date >= from)
            .Select(l => l.Date)
            .ToHashSet();

        var rows = new List<string>();
        for (int row = 0; row < 3; row++)
        {
            var dots = new System.Text.StringBuilder();
            for (int col = 0; col < 10; col++)
            {
                var d = from.AddDays(row * 10 + col);
                dots.Append(completed.Contains(d) ? "🟩" : (d == today ? "⬜" : "🟥"));
            }
            rows.Add(dots.ToString());
        }
        var grid = string.Join("\n", rows);

        string titleLine;
        string statsLine;

        if (habit.FrequencyType == FrequencyType.Weekly)
        {
            var (done, target) = HabitService.WeeklyProgress(habit);
            var total = habit.Logs.Count(l => l.Completed);
            titleLine = $"**{done}/{target} this week**";
            statsLine = $"Last 28 days: **{HabitService.FlexibleStreak(habit, 28)}/28** · Total: **{total}**";
        }
        else
        {
            var (streak, graceUsed) = HabitService.ConsecutiveStreak(habit, grace);
            var best   = HabitService.BestStreak(habit);
            var last30 = HabitService.FlexibleStreak(habit, 30);
            var total  = habit.Logs.Count(l => l.Completed);
            var graceStr = graceUsed > 0 ? $" _(+{graceUsed} flex)_" : "";
            var streakFireCount = Math.Min(streak / 7 + 1, 5);
            titleLine = $"**{streak}-day streak**{graceStr} {string.Concat(Enumerable.Repeat("🔥", streakFireCount))}";
            statsLine = $"Last 30 days: **{last30}/30** · Best ever: **{best}** · Total: **{total}**";
        }

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle($"🔥 {habit.Name} _({FrequencyLabel(habit)})_")
            .WithDescription($"{titleLine}\n\n{grid}\n\n{statsLine}")
            .WithFooter($"Tracked by {Context.User.Username} via Ember 🔥")
            .WithTimestamp(DateTimeOffset.UtcNow)
            .Build();

        await RespondAsync(embed: embed);
    }

    // ── /habit delete ─────────────────────────────────────────────────────────

    [SlashCommand("delete", "Remove a habit and stop tracking it")]
    public async Task DeleteAsync(
        [Summary("habit", "Which habit to remove?"), Autocomplete(typeof(HabitAutocompleteHandler))] int habitId)
    {
        var deleted = await _habits.DeleteHabitAsync(Context.User.Id, habitId);

        if (!deleted)
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        await RespondAsync("Habit removed. No judgement — you can always start fresh with `/habit add`. 💙", ephemeral: true);
    }

    // ── /habit edit ───────────────────────────────────────────────────────────

    [SlashCommand("edit", "Edit a habit's name or reminder time")]
    public async Task EditAsync(
        [Summary("habit", "Which habit to edit?"), Autocomplete(typeof(HabitAutocompleteHandler))] int habitId,
        [Summary("name", "New name for the habit")] string? name = null,
        [Summary("clear_reminder", "Remove the reminder entirely")] bool clearReminder = false)
    {
        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);

        if (habit is null)
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        if (name is not null || clearReminder)
        {
            var updated = await _habits.EditHabitAsync(Context.User.Id, habitId, name, newReminderTime: null, clearReminder);

            if (updated is null)
            {
                await RespondAsync("Couldn't find that habit.", ephemeral: true);
                return;
            }

            var embed = new EmbedBuilder()
                .WithColor(0xF4845F)
                .WithTitle("Habit updated!")
                .AddField("Name", updated.Name, inline: true)
                .AddField("Reminder", await FormatReminderAsync(updated.ReminderTime), inline: true)
                .Build();

            await RespondAsync(embed: embed, ephemeral: true);
            return;
        }

        var components = new ComponentBuilder()
            .WithButton("Change reminder", $"reminder:set:{habitId}", ButtonStyle.Primary, new Emoji("⏰"))
            .WithButton("Remove reminder", $"reminder:clear:{habitId}", ButtonStyle.Danger)
            .WithButton("Cancel", $"reminder:cancel:{habitId}", ButtonStyle.Secondary)
            .Build();

        await RespondAsync(
            $"What would you like to change about **{habit.Name}**?",
            components: components,
            ephemeral: true);
    }

    // ── /habit frequency ──────────────────────────────────────────────────────

    [SlashCommand("frequency", "Change how often a habit needs to be done")]
    public async Task FrequencyAsync(
        [Summary("habit", "Which habit?"), Autocomplete(typeof(HabitAutocompleteHandler))] int habitId,
        [Summary("type", "Daily or weekly")] FrequencyType type = FrequencyType.Daily)
    {
        if (type == FrequencyType.Daily)
        {
            var habit = await _habits.SetFrequencyAsync(Context.User.Id, habitId, FrequencyType.Daily, null);
            if (habit is null) { await RespondAsync("Couldn't find that habit.", ephemeral: true); return; }
            await RespondAsync($"**{habit.Name}** is now daily — check in every day.", ephemeral: true);
            return;
        }

        // Weekly — ask for target via buttons rather than a raw parameter
        var components = new ComponentBuilder()
            .WithButton("2× / week", $"freq:weekly:{habitId}:2", ButtonStyle.Secondary)
            .WithButton("3× / week", $"freq:weekly:{habitId}:3", ButtonStyle.Primary)
            .WithButton("4× / week", $"freq:weekly:{habitId}:4", ButtonStyle.Secondary)
            .WithButton("5× / week", $"freq:weekly:{habitId}:5", ButtonStyle.Secondary)
            .WithButton("6× / week", $"freq:weekly:{habitId}:6", ButtonStyle.Secondary)
            .Build();

        await RespondAsync("How many times per week?", components: components, ephemeral: true);
    }

    // ── /habit pause ──────────────────────────────────────────────────────────

    [SlashCommand("pause", "Pause a habit temporarily — reminders stop and streak is protected")]
    public async Task PauseAsync(
        [Summary("habit", "Which habit to pause?"), Autocomplete(typeof(HabitAutocompleteHandler))] int habitId,
        [Summary("duration", "How long to pause for")] PauseDuration duration = PauseDuration.OneWeek)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var pausedUntil = duration switch
        {
            PauseDuration.Today     => (DateOnly?)today,
            PauseDuration.ThreeDays => today.AddDays(2),
            PauseDuration.OneWeek   => today.AddDays(6),
            PauseDuration.Resume    => null,
            _                       => today.AddDays(6)
        };

        var habit = await _habits.PauseHabitAsync(Context.User.Id, habitId, pausedUntil);

        if (habit is null)
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        if (duration == PauseDuration.Resume)
            await RespondAsync($"**{habit.Name}** is back on. Welcome back! 🔥", ephemeral: true);
        else
            await RespondAsync(
                $"**{habit.Name}** is paused until **{pausedUntil:MMM d}**.\n" +
                "Reminders are off and missed days won't count against your streak. Rest well. 💙",
                ephemeral: true);
    }

    // ── /habit grace ──────────────────────────────────────────────────────────

    [SlashCommand("grace", "Set how many flex days per week you get before a streak breaks")]
    public async Task GraceAsync(
        [Summary("days", "Flex days per week (0–3)")] int days)
    {
        if (days < 0 || days > 3)
        {
            await RespondAsync("Flex days must be between 0 and 3.", ephemeral: true);
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

        await RespondAsync($"Flex days set to **{days}/week**. {description}", ephemeral: true);
    }
}

public enum PauseDuration
{
    [ChoiceDisplay("Today only")]       Today,
    [ChoiceDisplay("3 days")]           ThreeDays,
    [ChoiceDisplay("1 week")]           OneWeek,
    [ChoiceDisplay("Resume (unpause)")] Resume,
}
