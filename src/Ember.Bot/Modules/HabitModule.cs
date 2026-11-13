using Discord;
using Discord.Interactions;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

[Group("habit", "Track your habits")]
public class HabitModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;
    private readonly IConfiguration _config;

    public HabitModule(HabitService habits, IConfiguration config)
    {
        _habits = habits;
        _config = config;
    }

    /// <summary>The "Reminder:" line with the reminder times as set, in the user's Ember timezone (not the viewer's device timezone).</summary>
    internal static string FormatReminder(IReadOnlyList<TimeOnly> localTimes)
        => localTimes.Count switch
        {
            0 => "Reminder: None set",
            1 => $"Reminder: {FormatTimes(localTimes)} your time",
            _ => $"Reminders: {FormatTimes(localTimes)} your time",
        };

    /// <summary>The times as <c>08:00, 13:00, 20:00</c>.</summary>
    internal static string FormatTimes(IEnumerable<TimeOnly> times)
        => string.Join(", ", times.Select(t => t.ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture)));

    /// <summary>"Streak: **1** day" or "Streak: **n** days".</summary>
    internal static string StreakText(int streak) => $"Streak: **{streak}** {(streak == 1 ? "day" : "days")}";

    internal static string FrequencyLabel(Habit h)
    {
        var times = h.TimesPerDay > 1 ? $" · {h.TimesPerDay}×/day" : "";
        return h.FrequencyType switch
        {
            FrequencyType.Weekly   => $"{h.WeeklyTarget ?? 3}×/week",
            FrequencyType.Weekdays => string.Join(" ", ScheduleDayNames.ToNames(h.Days.GetValueOrDefault())
                .Select(n => char.ToUpperInvariant(n[0]) + n[1..])) + times,
            _                      => "daily" + times,
        };
    }

    /// <summary>The habit's status on <paramref name="day"/>: ✅ done, 🔸 2/3 partly done, 💤 rest day (not scheduled), ⬜ otherwise.</summary>
    internal static string DayMark(Habit h, DateOnly day)
    {
        var log = h.Logs.FirstOrDefault(l => l.Date == day);
        return log?.Completed == true ? "✅"
            : log is { Count: > 0 } ? $"🔸 {log.Count}/{h.TimesPerDay}"
            : !HabitService.IsScheduledOn(h, day) ? "💤"
            : "⬜";
    }

    /// <summary>
    /// The reply after a check-in that added one: <paramref name="doneText"/> once the day is done (with the count for
    /// multi-count habits), else the count so far, for today or for <paramref name="dayLabel"/>.
    /// </summary>
    internal static string CheckInText(Habit? habit, DateOnly day, string doneText, string? dayLabel = null)
    {
        if (habit is null || habit.TimesPerDay == 1) return doneText;
        var log = habit.Logs.FirstOrDefault(l => l.Date == day);
        var count = $"{log?.Count ?? 0}/{habit.TimesPerDay}";
        return log?.Completed == true
            ? $"{doneText} ({count})"
            : $"Logged **{count}** {(dayLabel is null ? "today" : $"for {dayLabel}")}. Every one counts. 🔸";
    }

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
            var label = h.Name.Length > SelectMenuOptionBuilder.MaxSelectLabelLength
                ? h.Name[..SelectMenuOptionBuilder.MaxSelectLabelLength]
                : h.Name;
            menu.AddOption(label, h.Id.ToString(), FrequencyLabel(h));
        }

        return menu;
    }

    // ── /habit add ────────────────────────────────────────────────────────────

    [SlashCommand("add", "Add a new habit to track")]
    public async Task AddAsync()
    {
        if (!await _habits.HasHealthDataConsentAsync(Context.User.Id))
        {
            await ConsentModule.RespondWithPromptAsync(Context, _config, _habits);
            return;
        }

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
        if (!await _habits.HasHealthDataConsentAsync(Context.User.Id))
        {
            await ConsentModule.RespondWithPromptAsync(Context, _config, _habits);
            return;
        }

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
        var today  = await _habits.GetLocalTodayAsync(Context.User.Id);
        var lowDays = await _habits.GetLowDaysAsync(Context.User.Id);
        var tz     = await _habits.GetUserTzAsync(Context.User.Id);
        var showStreaks = await _habits.GetShowStreaksAsync(Context.User.Id);

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
                var todayMark    = DayMark(h, today);
                var reminderStr  = FormatReminder(h.ReminderTimes);
                var pauseStr     = h.PausedUntil.HasValue && h.PausedUntil >= today
                    ? $" · ⏸️ paused until {h.PausedUntil:MMM d}" : "";

                var progressStr  = ListProgress(h, today, grace, lowDays, tz, showStreaks);

                embed.AddField(
                    $"{todayMark} {h.Name}{pauseStr} _({FrequencyLabel(h)})_",
                    $"{progressStr}\n{reminderStr}",
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

    // ── /habit history ────────────────────────────────────────────────────────

    [SlashCommand("history", "See and fill in the last two weeks of a habit, and mark low days")]
    public async Task HistoryAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        if (habits.Count == 0)
        {
            await RespondAsync("You don't have any habits yet. Use `/habit add` to get started!", ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(habits, "history", "Which habit do you want to look at?");
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync("Which habit's history do you want to see?", components: components, ephemeral: true);
    }

    // ── /habit streak ─────────────────────────────────────────────────────────

    [SlashCommand("streak", "See your personal habit stats")]
    public async Task StreakAsync()
    {
        var (pages, toggle) = await RenderStatsAsync(_habits, Context.User.Id);

        if (pages.Count == 0)
        {
            await RespondAsync(NoStatsText, ephemeral: true);
            return;
        }

        await RespondAsync(embed: pages[0], components: toggle, ephemeral: true);
        foreach (var page in pages.Skip(1))
            await FollowupAsync(embed: page, ephemeral: true);
    }

    internal const string NoStatsText = "No habits tracked yet. Use `/habit add` to begin!";

    /// <summary>
    /// The <c>/habit streak</c> reply: one stats embed per page of habits (none without habits) and the button that flips
    /// <see cref="User.ShowStreaks"/> ("habit:streaks:on" / "habit:streaks:off"). With streaks off the stats have no streak lines.
    /// </summary>
    internal static async Task<(List<Embed> Pages, MessageComponent Toggle)> RenderStatsAsync(HabitService service, ulong userId)
    {
        var habits = await service.GetHabitsAsync(userId);
        var grace  = await service.GetGraceDaysAsync(userId);
        var today  = await service.GetLocalTodayAsync(userId);
        var lowDays = await service.GetLowDaysAsync(userId);
        var tz     = await service.GetUserTzAsync(userId);
        var showStreaks = await service.GetShowStreaksAsync(userId);

        var toggle = new ComponentBuilder()
            .WithButton(showStreaks ? "Hide streaks" : "Show streaks", $"habit:streaks:{(showStreaks ? "off" : "on")}", ButtonStyle.Secondary)
            .Build();

        const int pageSize = 6;
        var pages = (int)Math.Ceiling(habits.Count / (double)pageSize);
        var embeds = new List<Embed>();

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
                    var (done, target) = HabitService.WeeklyProgress(h, today);
                    var total  = h.Logs.Count(l => l.Completed);
                    var last28 = HabitService.FlexibleStreak(h, today, 28);
                    statsText =
                        $"This week: **{done}/{target}**\n" +
                        $"Last 28 days: **{last28}/28** · Total: **{total}**";
                }
                else if (!showStreaks)
                {
                    var last7  = HabitService.FlexibleStreak(h, today, 7, lowDays, tz);
                    var last30 = HabitService.FlexibleStreak(h, today, 30, lowDays, tz);
                    statsText =
                        $"Last 7: **{last7}/7** · Last 30: **{last30}/30**\n" +
                        $"Total: **{h.Logs.Count(l => l.Completed)}**";
                }
                else
                {
                    var (streak, graceUsed) = HabitService.ConsecutiveStreak(h, today, grace, lowDays);
                    var last7  = HabitService.FlexibleStreak(h, today, 7, lowDays, tz);
                    var last30 = HabitService.FlexibleStreak(h, today, 30, lowDays, tz);
                    var best   = HabitService.BestStreak(h, today, grace, lowDays);
                    var total  = h.Logs.Count(l => l.Completed);
                    var graceStr = graceUsed > 0 ? $"\n_({graceUsed} flex day{(graceUsed > 1 ? "s" : "")} used)_" : "";
                    statsText =
                        $"{StreakText(streak)}{graceStr}\n" +
                        $"Last 7: **{last7}/7** · Last 30: **{last30}/30**\n" +
                        $"Best: **{best}** · Total: **{total}**";
                }

                embed.AddField(
                    $"🔥 {h.Name} _({FrequencyLabel(h)})_",
                    statsText,
                    inline: true);
            }

            embed.WithFooter(showStreaks
                ? $"Flex days: {grace}/week · Every check-in counts, no matter the gap."
                : "Every check-in counts, no matter the gap.");
            embeds.Add(embed.Build());
        }

        return (embeds, toggle);
    }

    /// <summary>The <c>/habit list</c> progress line of <paramref name="h"/>; without <paramref name="showStreaks"/> it has no streak.</summary>
    internal static string ListProgress(Habit h, DateOnly today, int grace, IReadOnlySet<DateOnly> lowDays, TimeZoneInfo tz, bool showStreaks)
    {
        if (h.FrequencyType == FrequencyType.Weekly)
        {
            var (done, target) = HabitService.WeeklyProgress(h, today);
            return $"This week: **{done}/{target}** · Last 4 wks: **{HabitService.FlexibleStreak(h, today, 28)}/28**";
        }

        var last7 = $"Last 7: **{HabitService.FlexibleStreak(h, today, 7, lowDays, tz)}/7**";
        if (!showStreaks) return last7;
        var (streak, graceUsed) = HabitService.ConsecutiveStreak(h, today, grace, lowDays);
        var graceStr = graceUsed > 0 ? $" _(+{graceUsed} flex)_" : "";
        return $"{StreakText(streak)}{graceStr} · {last7}";
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

    [SlashCommand("pause", "Pause a habit temporarily — reminders stop while it's paused")]
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
            "How many unlogged days per week can a streak carry before it resets?",
            components: components,
            ephemeral: true);
    }

    // ── /habit second-reminder ────────────────────────────────────────────────

    [SlashCommand("second-reminder", "Get one more nudge after a reminder if you haven't checked in yet")]
    public async Task SecondReminderAsync([Summary("delay", "How long after a reminder")] SecondReminderDelay delay)
    {
        var minutes = (int)delay;
        await _habits.SetSecondReminderMinutesAsync(Context.User.Id, minutes);

        await RespondAsync(minutes == 0
                ? "Second reminder off. One reminder it is. 💙"
                : $"Got it. If you haven't checked in yet, I'll nudge you once more **{SecondReminderLabel(delay)}** after a reminder. 💙",
            ephemeral: true);
    }

    private static string SecondReminderLabel(SecondReminderDelay delay) => delay switch
    {
        SecondReminderDelay.FifteenMinutes => "15 minutes",
        SecondReminderDelay.ThirtyMinutes => "30 minutes",
        SecondReminderDelay.OneHour => "1 hour",
        _ => "2 hours",
    };
}

/// <summary>The <c>/habit second-reminder</c> choices; each value is <see cref="Core.Models.User.SecondReminderMinutes"/>.</summary>
public enum SecondReminderDelay
{
    [ChoiceDisplay("Off")] Off = 0,
    [ChoiceDisplay("15 minutes")] FifteenMinutes = 15,
    [ChoiceDisplay("30 minutes")] ThirtyMinutes = 30,
    [ChoiceDisplay("1 hour")] OneHour = 60,
    [ChoiceDisplay("2 hours")] TwoHours = 120,
}

public enum PauseDuration
{
    [ChoiceDisplay("Today only")]       Today,
    [ChoiceDisplay("3 days")]           ThreeDays,
    [ChoiceDisplay("1 week")]           OneWeek,
    [ChoiceDisplay("Resume (unpause)")] Resume,
}
