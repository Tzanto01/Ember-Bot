using Ember.Core.Localization;
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
    internal static string FormatReminder(Texts t, IReadOnlyList<TimeOnly> localTimes)
        => localTimes.Count switch
        {
            0 => t.Get("habit.reminder.none"),
            1 => t.Format("habit.reminder.single", FormatTimes(localTimes)),
            _ => t.Format("habit.reminder.several", FormatTimes(localTimes)),
        };

    /// <summary>The times as <c>08:00, 13:00, 20:00</c>.</summary>
    internal static string FormatTimes(IEnumerable<TimeOnly> times)
        => string.Join(", ", times.Select(t => t.ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture)));

    /// <summary>"Streak: **1** day" or "Streak: **n** days".</summary>
    internal static string StreakText(Texts t, int streak) => t.Plural("habit.streak", streak);

    internal static string FrequencyLabel(Texts t, Habit h)
    {
        var times = h.TimesPerDay > 1 ? " · " + t.Format("habit.freq.per-day", h.TimesPerDay) : "";
        return h.FrequencyType switch
        {
            FrequencyType.Weekly   => t.Format("habit.freq.weekly", h.WeeklyTarget ?? 3),
            FrequencyType.Weekdays => string.Join(" ", ScheduleDayNames.ToNames(h.Days.GetValueOrDefault()).Select(n => DayName(t, n))) + times,
            _                      => t.Get("habit.freq.daily") + times,
        };
    }

    /// <summary>The short name of a <see cref="ScheduleDayNames"/> day (<c>mon</c> → "Mon" / "Mo").</summary>
    internal static string DayName(Texts t, string name) => t.Get("weekday." + name);

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
    internal static string CheckInText(Texts t, Habit? habit, DateOnly day, string doneText, string? dayLabel = null)
    {
        if (habit is null || habit.TimesPerDay == 1) return doneText;
        var log = habit.Logs.FirstOrDefault(l => l.Date == day);
        var count = $"{log?.Count ?? 0}/{habit.TimesPerDay}";
        return log?.Completed == true
            ? $"{doneText} ({count})"
            : dayLabel is null ? t.Format("habit.checkin.count.today", count) : t.Format("habit.checkin.count.day", count, dayLabel);
    }

    // ── Habit select menu builder (shared by several commands) ───────────────

    internal static SelectMenuBuilder BuildHabitSelectMenu(
        Texts t,
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
            menu.AddOption(label, h.Id.ToString(), FrequencyLabel(t, h));
        }

        return menu;
    }

    // ── /habit add ────────────────────────────────────────────────────────────

    [SlashCommand("add", "Add a new habit to track")]
    public async Task AddAsync()
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!await _habits.HasHealthDataConsentAsync(Context.User.Id))
        {
            await ConsentModule.RespondWithPromptAsync(Context, _config, _habits);
            return;
        }

        var modal = new ModalBuilder()
            .WithTitle(t.Get("habit.add.modal.title"))
            .WithCustomId("habit:add:modal")
            .AddTextInput(t.Get("habit.add.modal.label"), "habit_name",
                placeholder: t.Get("habit.add.modal.placeholder"),
                minLength: 1, maxLength: 100, required: true)
            .Build();

        await RespondWithModalAsync(modal);
    }

    // ── /habit template ───────────────────────────────────────────────────────

    [SlashCommand("template", "Start a habit from a pre-built template")]
    public async Task TemplateAsync()
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!await _habits.HasHealthDataConsentAsync(Context.User.Id))
        {
            await ConsentModule.RespondWithPromptAsync(Context, _config, _habits);
            return;
        }

        var menu = new SelectMenuBuilder()
            .WithCustomId("habit:template:select")
            .WithPlaceholder(t.Get("habit.template.placeholder"))
            .WithMinValues(1)
            .WithMaxValues(1);

        foreach (var template in HabitTemplates.All)
        {
            var freqHint = " · " + (template.Frequency == HabitTemplates.FrequencyHint.Weekly
                ? t.Format("habit.freq.weekly", template.WeeklyTarget)
                : t.Get("habit.freq.daily"));
            menu.AddOption(
                label: TemplateSelectModule.Name(t, template),
                value: template.Key,
                description: $"{TemplateSelectModule.Description(t, template)}{freqHint}");
        }

        var components = new ComponentBuilder().WithSelectMenu(menu).Build();

        await RespondAsync(
            t.Get("habit.template.prompt"),
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
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (habits.Count == 0)
        {
            await RespondAsync(t.Get("habit.none.start-both"), ephemeral: true);
            return;
        }

        const int pageSize = 8;
        var pages = (int)Math.Ceiling(habits.Count / (double)pageSize);

        for (int page = 0; page < pages; page++)
        {
            var slice = habits.Skip(page * pageSize).Take(pageSize).ToList();

            var embed = new EmbedBuilder()
                .WithColor(0xF4845F)
                .WithTitle(pages > 1 ? t.Format("habit.list.title.paged", page + 1, pages) : t.Get("habit.list.title"));

            foreach (var h in slice)
            {
                var todayMark    = DayMark(h, today);
                var reminderStr  = FormatReminder(t, h.ReminderTimes);
                var pauseStr     = h.PausedUntil.HasValue && h.PausedUntil >= today
                    ? " · " + t.Format("habit.list.paused", h.PausedUntil.Value.ToString(t.Get("date.month-day"), t.Culture)) : "";

                var progressStr  = ListProgress(t, h, today, grace, lowDays, tz, showStreaks);

                embed.AddField(
                    $"{todayMark} {h.Name}{pauseStr} _({FrequencyLabel(t, h)})_",
                    $"{progressStr}\n{reminderStr}",
                    inline: false);
            }

            embed.WithFooter(t.Get("habit.list.footer"));

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

        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (habits.Count == 0)
        {
            await RespondAsync(t.Get("habit.none.start"), ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(t, habits, "checkin", t.Get("habit.checkin.placeholder"));
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync(t.Get("habit.checkin.prompt"), components: components, ephemeral: true);
    }

    // ── /habit history ────────────────────────────────────────────────────────

    [SlashCommand("history", "See and fill in the last two weeks of a habit, and mark low days")]
    public async Task HistoryAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (habits.Count == 0)
        {
            await RespondAsync(t.Get("habit.none.start"), ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(t, habits, "history", t.Get("habit.history.placeholder"));
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync(t.Get("habit.history.prompt"), components: components, ephemeral: true);
    }

    // ── /habit streak ─────────────────────────────────────────────────────────

    [SlashCommand("streak", "See your personal habit stats")]
    public async Task StreakAsync()
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        var (pages, toggle) = await RenderStatsAsync(t, _habits, Context.User.Id);

        if (pages.Count == 0)
        {
            await RespondAsync(t.Get("habit.stats.none"), ephemeral: true);
            return;
        }

        await RespondAsync(embed: pages[0], components: toggle, ephemeral: true);
        foreach (var page in pages.Skip(1))
            await FollowupAsync(embed: page, ephemeral: true);
    }

    /// <summary>
    /// The <c>/habit streak</c> reply: one stats embed per page of habits (none without habits) and the button that flips
    /// <see cref="User.ShowStreaks"/> ("habit:streaks:on" / "habit:streaks:off"). With streaks off the stats have no streak lines.
    /// </summary>
    internal static async Task<(List<Embed> Pages, MessageComponent Toggle)> RenderStatsAsync(Texts t, HabitService service, ulong userId)
    {
        var habits = await service.GetHabitsAsync(userId);
        var grace  = await service.GetGraceDaysAsync(userId);
        var today  = await service.GetLocalTodayAsync(userId);
        var lowDays = await service.GetLowDaysAsync(userId);
        var tz     = await service.GetUserTzAsync(userId);
        var showStreaks = await service.GetShowStreaksAsync(userId);

        var toggle = new ComponentBuilder()
            .WithButton(t.Get(showStreaks ? "habit.stats.hide-streaks" : "habit.stats.show-streaks"), $"habit:streaks:{(showStreaks ? "off" : "on")}", ButtonStyle.Secondary)
            .Build();

        const int pageSize = 6;
        var pages = (int)Math.Ceiling(habits.Count / (double)pageSize);
        var embeds = new List<Embed>();

        for (int page = 0; page < pages; page++)
        {
            var slice = habits.Skip(page * pageSize).Take(pageSize).ToList();

            var embed = new EmbedBuilder()
                .WithColor(0xF4845F)
                .WithTitle(pages > 1 ? t.Format("habit.stats.title.paged", page + 1, pages) : t.Get("habit.stats.title"));

            foreach (var h in slice)
            {
                string statsText;
                if (h.FrequencyType == FrequencyType.Weekly)
                {
                    var (done, target) = HabitService.WeeklyProgress(h, today);
                    var total  = h.Logs.Count(l => l.Completed);
                    var last28 = HabitService.FlexibleStreak(h, today, 28);
                    statsText = t.Format("habit.stats.weekly", done, target, last28, total);
                }
                else if (!showStreaks)
                {
                    var last7  = HabitService.FlexibleStreak(h, today, 7, lowDays, tz);
                    var last30 = HabitService.FlexibleStreak(h, today, 30, lowDays, tz);
                    statsText = t.Format("habit.stats.flexible", last7, last30, h.Logs.Count(l => l.Completed));
                }
                else
                {
                    var (streak, graceUsed) = HabitService.ConsecutiveStreak(h, today, grace, lowDays);
                    var last7  = HabitService.FlexibleStreak(h, today, 7, lowDays, tz);
                    var last30 = HabitService.FlexibleStreak(h, today, 30, lowDays, tz);
                    var best   = HabitService.BestStreak(h, today, grace, lowDays);
                    var total  = h.Logs.Count(l => l.Completed);
                    var graceStr = graceUsed > 0 ? "\n" + t.Plural("habit.stats.grace-used", graceUsed) : "";
                    statsText = t.Format("habit.stats.streak", StreakText(t, streak), graceStr, last7, last30, best, total);
                }

                embed.AddField(
                    $"🔥 {h.Name} _({FrequencyLabel(t, h)})_",
                    statsText,
                    inline: true);
            }

            embed.WithFooter(showStreaks ? t.Format("habit.stats.footer.grace", grace) : t.Get("habit.stats.footer"));
            embeds.Add(embed.Build());
        }

        return (embeds, toggle);
    }

    /// <summary>The <c>/habit list</c> progress line of <paramref name="h"/>; without <paramref name="showStreaks"/> it has no streak.</summary>
    internal static string ListProgress(Texts t, Habit h, DateOnly today, int grace, IReadOnlySet<DateOnly> lowDays, TimeZoneInfo tz, bool showStreaks)
    {
        if (h.FrequencyType == FrequencyType.Weekly)
        {
            var (done, target) = HabitService.WeeklyProgress(h, today);
            return t.Format("habit.progress.weekly", done, target, HabitService.FlexibleStreak(h, today, 28));
        }

        var last7 = t.Format("habit.progress.last7", HabitService.FlexibleStreak(h, today, 7, lowDays, tz));
        if (!showStreaks) return last7;
        var (streak, graceUsed) = HabitService.ConsecutiveStreak(h, today, grace, lowDays);
        var graceStr = graceUsed > 0 ? " " + t.Plural("habit.progress.grace", graceUsed) : "";
        return $"{StreakText(t, streak)}{graceStr} · {last7}";
    }

    // ── /habit share ──────────────────────────────────────────────────────────

    [SlashCommand("share", "Share a habit card publicly in this channel")]
    public async Task ShareAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (habits.Count == 0)
        {
            await RespondAsync(t.Get("habit.none.start"), ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(t, habits, "share", t.Get("habit.share.prompt"));
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync(t.Get("habit.share.prompt"), components: components, ephemeral: true);
    }

    // ── /habit delete ─────────────────────────────────────────────────────────

    [SlashCommand("delete", "Remove a habit and stop tracking it")]
    public async Task DeleteAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (habits.Count == 0)
        {
            await RespondAsync(t.Get("habit.delete.none"), ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(t, habits, "delete", t.Get("habit.delete.placeholder"));
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync(t.Get("habit.delete.prompt"), components: components, ephemeral: true);
    }

    // ── /habit edit ───────────────────────────────────────────────────────────

    [SlashCommand("edit", "Edit a habit's name or reminder time")]
    public async Task EditAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (habits.Count == 0)
        {
            await RespondAsync(t.Get("habit.edit.none"), ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(t, habits, "edit", t.Get("habit.edit.prompt"));
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync(t.Get("habit.edit.prompt"), components: components, ephemeral: true);
    }

    // ── /habit frequency ──────────────────────────────────────────────────────

    [SlashCommand("frequency", "Change how often a habit needs to be done")]
    public async Task FrequencyAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (habits.Count == 0)
        {
            await RespondAsync(t.Get("habit.none"), ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(t, habits, "frequency", t.Get("habit.frequency.placeholder"));
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync(t.Get("habit.frequency.prompt"), components: components, ephemeral: true);
    }

    // ── /habit pause ──────────────────────────────────────────────────────────

    [SlashCommand("pause", "Pause a habit temporarily — reminders stop while it's paused")]
    public async Task PauseAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (habits.Count == 0)
        {
            await RespondAsync(t.Get("habit.pause.none"), ephemeral: true);
            return;
        }

        var menu = BuildHabitSelectMenu(t, habits, "pause", t.Get("habit.pause.prompt"));
        var components = new ComponentBuilder().WithSelectMenu(menu).Build();
        await RespondAsync(t.Get("habit.pause.prompt"), components: components, ephemeral: true);
    }

    // ── /habit grace ──────────────────────────────────────────────────────────

    [SlashCommand("grace", "Set how many flex days per week you get before a streak breaks")]
    public async Task GraceAsync()
    {
        var current = await _habits.GetGraceDaysAsync(Context.User.Id);
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        var components = new ComponentBuilder()
            .WithButton(t.Get("habit.grace.strict"),           "habit:grace:0", current == 0 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .WithButton(t.Plural("habit.grace.button", 1),     "habit:grace:1", current == 1 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .WithButton(t.Plural("habit.grace.button", 2),     "habit:grace:2", current == 2 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .WithButton(t.Plural("habit.grace.button", 3),     "habit:grace:3", current == 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .Build();

        await RespondAsync(
            t.Plural("habit.grace.current", current),
            components: components,
            ephemeral: true);
    }

    // ── /habit second-reminder ────────────────────────────────────────────────

    [SlashCommand("second-reminder", "Get one more nudge after a reminder if you haven't checked in yet")]
    public async Task SecondReminderAsync([Summary("delay", "How long after a reminder")] SecondReminderDelay delay)
    {
        var minutes = (int)delay;
        await _habits.SetSecondReminderMinutesAsync(Context.User.Id, minutes, Languages.FromLocale(Context.Interaction.UserLocale));
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        await RespondAsync(minutes == 0
                ? t.Get("habit.second-reminder.off")
                : t.Format("habit.second-reminder.on", SecondReminderLabel(t, delay)),
            ephemeral: true);
    }

    private static string SecondReminderLabel(Texts t, SecondReminderDelay delay) => t.Get(delay switch
    {
        SecondReminderDelay.FifteenMinutes => "duration.15m",
        SecondReminderDelay.ThirtyMinutes => "duration.30m",
        SecondReminderDelay.OneHour => "duration.1h",
        _ => "duration.2h",
    });
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
