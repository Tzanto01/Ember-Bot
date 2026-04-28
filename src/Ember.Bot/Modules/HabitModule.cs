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

    internal async Task<string> FormatReminderAsync(ulong userId, TimeOnly? localTime)
    {
        if (!localTime.HasValue) return "None set";
        var tz    = await _habits.GetUserTzAsync(userId);
        var utc   = TimezoneHelper.ToUtc(localTime.Value, tz);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var utcDt = DateTime.SpecifyKind(today.ToDateTime(utc), DateTimeKind.Utc);
        var unix  = new DateTimeOffset(utcDt).ToUnixTimeSeconds();
        return $"<t:{unix}:t>";
    }

    internal static string FrequencyLabel(Habit h) =>
        h.FrequencyType == FrequencyType.Weekly
            ? $"{h.WeeklyTarget ?? 3}×/week"
            : "daily";

    // ── Habit select menu builder (shared by several commands) ───────────────

    internal static SelectMenuBuilder BuildHabitSelectMenu(
        IReadOnlyList<Habit> habits,
        string action,
        string placeholder)
    {
        var menu = new SelectMenuBuilder()
            .WithCustomId($"habit:select:{action}")
            .WithPlaceholder(placeholder)
            .WithMinValues(1)
            .WithMaxValues(1);

        foreach (var h in habits.Take(25))
        {
            var label = h.Name.Length > 25 ? h.Name[..25] : h.Name;
            menu.AddOption(label, h.Id.ToString(), FrequencyLabel(h));
        }

        return menu;
    }

    // ── /habit add ────────────────────────────────────────────────────────────

    [SlashCommand("add", "Add a new habit to track")]
    public async Task AddAsync()
    {
        var modal = new ModalBuilder()
            .WithTitle("Add a new habit")
            .WithCustomId("habit:add:modal")
            .AddTextInput("What habit do you want to track?", "habit_name",
                placeholder: "e.g. Morning walk, Read 10 pages, Drink water",
                minLength: 1, maxLength: 100, required: true)
            .Build();

        await RespondWithModalAsync(modal);
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
                var reminderStr  = await FormatReminderAsync(Context.User.Id, h.ReminderTime);
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
    public async Task CheckInAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        if (habits.Count == 0)
        {
            await RespondAsync("You don't have any habits yet. Use `/habit add` to get started!", ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(habits, "checkin", "Which habit did you work on?");
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync("Which habit are you checking in?", components: components, ephemeral: true);
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
    public async Task ShareAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        if (habits.Count == 0)
        {
            await RespondAsync("You don't have any habits yet. Use `/habit add` to get started!", ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(habits, "share", "Which habit do you want to share?");
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync("Which habit do you want to share?", components: components, ephemeral: true);
    }

    // ── /habit delete ─────────────────────────────────────────────────────────

    [SlashCommand("delete", "Remove a habit and stop tracking it")]
    public async Task DeleteAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        if (habits.Count == 0)
        {
            await RespondAsync("You don't have any habits to delete.", ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(habits, "delete", "Which habit do you want to remove?");
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync("Which habit do you want to delete?", components: components, ephemeral: true);
    }

    // ── /habit edit ───────────────────────────────────────────────────────────

    [SlashCommand("edit", "Edit a habit's name or reminder time")]
    public async Task EditAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        if (habits.Count == 0)
        {
            await RespondAsync("You don't have any habits to edit.", ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(habits, "edit", "Which habit do you want to edit?");
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync("Which habit do you want to edit?", components: components, ephemeral: true);
    }

    // ── /habit frequency ──────────────────────────────────────────────────────

    [SlashCommand("frequency", "Change how often a habit needs to be done")]
    public async Task FrequencyAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        if (habits.Count == 0)
        {
            await RespondAsync("You don't have any habits yet.", ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(habits, "frequency", "Which habit do you want to change?");
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync("Which habit do you want to change the frequency for?", components: components, ephemeral: true);
    }

    // ── /habit pause ──────────────────────────────────────────────────────────

    [SlashCommand("pause", "Pause a habit temporarily — reminders stop and streak is protected")]
    public async Task PauseAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        if (habits.Count == 0)
        {
            await RespondAsync("You don't have any habits to pause.", ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(habits, "pause", "Which habit do you want to pause?");
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync("Which habit do you want to pause?", components: components, ephemeral: true);
    }

    // ── /habit grace ──────────────────────────────────────────────────────────

    [SlashCommand("grace", "Set how many flex days per week you get before a streak breaks")]
    public async Task GraceAsync()
    {
        var current = await _habits.GetGraceDaysAsync(Context.User.Id);

        var components = new ComponentBuilder()
            .WithButton("0 — strict",           "habit:grace:0", current == 0 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .WithButton("1 flex day",            "habit:grace:1", current == 1 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .WithButton("2 flex days",           "habit:grace:2", current == 2 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .WithButton("3 flex days",           "habit:grace:3", current == 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .Build();

        await RespondAsync(
            $"Your current setting: **{current} flex day{(current == 1 ? "" : "s")}/week**\n" +
            "How many missed days per week before a streak breaks?",
            components: components,
            ephemeral: true);
    }
}

public enum PauseDuration
{
    [ChoiceDisplay("Today only")]       Today,
    [ChoiceDisplay("3 days")]           ThreeDays,
    [ChoiceDisplay("1 week")]           OneWeek,
    [ChoiceDisplay("Resume (unpause)")] Resume,
}
