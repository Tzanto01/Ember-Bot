using Discord;
using Ember.Core.Localization;
using Discord.Interactions;
using Discord.Net;
using Discord.WebSocket;
using Ember.Core.Models;
using Ember.Core.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles habit:select:{action} select menus produced by HabitModule commands.
/// Routes to the appropriate follow-up buttons, modals, or immediate actions.
/// </summary>
public class HabitSelectModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public HabitSelectModule(HabitService habits)
    {
        _habits = habits;
    }

    // ── habit:select:checkin ──────────────────────────────────────────────────

    [ComponentInteraction("habit:select:checkin")]
    public async Task OnSelectCheckinAsync(string[] values)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(t); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(t); return; }

        var components = new ComponentBuilder()
            .WithButton(t.Get("habit.checkin.done-button"), $"habitaction:checkin:done:{habitId}", ButtonStyle.Success)
            .WithButton(Ember.Bot.Services.DiscordDmReminderChannel.SkipLabel(t), $"habitaction:checkin:skip:{habitId}", ButtonStyle.Secondary)
            .Build();

        var progress = habit.TimesPerDay > 1
            ? " " + t.Format("habit.checkin.so-far", HabitModule.DayMark(habit, await _habits.GetLocalTodayAsync(Context.User.Id)))
            : "";
        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Format("habit.checkin.question", habit.Name) + progress;
                m.Components = components;
            });
    }

    // ── habit:select:share ────────────────────────────────────────────────────

    [ComponentInteraction("habit:select:share")]
    public async Task OnSelectShareAsync(string[] values)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(t); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        var grace = await _habits.GetGraceDaysAsync(Context.User.Id);

        if (habit is null) { await NotFoundAsync(t); return; }

        var today = await _habits.GetLocalTodayAsync(Context.User.Id);
        var embed = BuildShareEmbed(t, habit, grace, Context.User.Username, today, await _habits.GetLowDaysAsync(Context.User.Id),
            await _habits.GetShowStreaksAsync(Context.User.Id));
        var component = (SocketMessageComponent)Context.Interaction;

        await component.DeferAsync();
        string reply;
        try
        {
            await component.FollowupAsync(embed: embed);
            reply = t.Get("habit.share.posted");
        }
        catch (HttpException)
        {
            reply = t.Get("habit.share.failed");
        }

        await component.ModifyOriginalResponseAsync(m =>
        {
            m.Content    = reply;
            m.Components = new ComponentBuilder().Build();
        });
    }

    // ── habit:select:delete ───────────────────────────────────────────────────

    [ComponentInteraction("habit:select:delete")]
    public async Task OnSelectDeleteAsync(string[] values)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(t); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(t); return; }

        var components = new ComponentBuilder()
            .WithButton(t.Get("habit.delete.confirm-button"), $"habitaction:delete:confirm:{habitId}", ButtonStyle.Danger)
            .WithButton(t.Get("common.cancel"), "habitaction:delete:cancel", ButtonStyle.Secondary)
            .Build();

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Format("habit.delete.confirm", habit.Name);
                m.Components = components;
            });
    }

    // ── habit:select:edit ─────────────────────────────────────────────────────

    [ComponentInteraction("habit:select:edit")]
    public async Task OnSelectEditAsync(string[] values)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(t); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(t); return; }

        var components = new ComponentBuilder()
            .WithButton(t.Get("habit.edit.rename"),          $"habitaction:edit:rename:{habitId}",   ButtonStyle.Primary, new Emoji("✏️"))
            .WithButton(t.Get("habit.edit.change-reminder"), $"reminder:set:{habitId}",              ButtonStyle.Secondary, new Emoji("⏰"))
            .WithButton(t.Get("habit.edit.remove-reminder"), $"reminder:clear:{habitId}",            ButtonStyle.Danger)
            .WithButton(t.Get("common.cancel"),              $"reminder:cancel:{habitId}",           ButtonStyle.Secondary)
            .Build();

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Format("habit.edit.question", habit.Name);
                m.Components = components;
            });
    }

    // ── habit:select:pause ────────────────────────────────────────────────────

    [ComponentInteraction("habit:select:pause")]
    public async Task OnSelectPauseAsync(string[] values)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(t); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(t); return; }

        var isPaused = habit.PausedUntil.HasValue &&
                       habit.PausedUntil >= await _habits.GetLocalTodayAsync(Context.User.Id);

        var builder = new ComponentBuilder()
            .WithButton(t.Get("habit.pause.today"), $"habitaction:pause:{habitId}:today",    ButtonStyle.Secondary)
            .WithButton(t.Get("habit.pause.3days"), $"habitaction:pause:{habitId}:3days",    ButtonStyle.Secondary)
            .WithButton(t.Get("habit.pause.1week"), $"habitaction:pause:{habitId}:1week",    ButtonStyle.Primary);

        if (isPaused)
            builder.WithButton(t.Get("habit.pause.resume-button"), $"habitaction:pause:{habitId}:resume", ButtonStyle.Success);

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Format("habit.pause.question", habit.Name);
                m.Components = builder.Build();
            });
    }

    // ── habit:select:frequency ────────────────────────────────────────────────

    [ComponentInteraction("habit:select:frequency")]
    public async Task OnSelectFrequencyAsync(string[] values)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(t); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(t); return; }

        var components = FrequencyComponents(t, habitId);

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Format("habit.frequency.question", habit.Name);
                m.Components = components;
            });
    }

    /// <summary>The schedule buttons: daily, 1–6× per week, specific weekdays and times per day.</summary>
    internal static MessageComponent FrequencyComponents(Texts t, int habitId) =>
        new ComponentBuilder()
            .WithButton(t.Get("freq.button.daily"),        $"habitaction:freq:{habitId}:daily",   ButtonStyle.Primary,    row: 0)
            .WithButton(t.Format("freq.button.weekly", 1), $"freq:weekly:{habitId}:1",            ButtonStyle.Secondary,  row: 0)
            .WithButton(t.Format("freq.button.weekly", 2), $"freq:weekly:{habitId}:2",            ButtonStyle.Secondary,  row: 0)
            .WithButton(t.Format("freq.button.weekly", 3), $"freq:weekly:{habitId}:3",            ButtonStyle.Secondary,  row: 0)
            .WithButton(t.Format("freq.button.weekly", 4), $"freq:weekly:{habitId}:4",            ButtonStyle.Secondary,  row: 0)
            .WithButton(t.Format("freq.button.weekly", 5), $"freq:weekly:{habitId}:5",            ButtonStyle.Secondary,  row: 1)
            .WithButton(t.Format("freq.button.weekly", 6), $"freq:weekly:{habitId}:6",            ButtonStyle.Secondary,  row: 1)
            .WithButton(t.Get("freq.button.weekdays"),     $"freq:weekdays:{habitId}",     ButtonStyle.Secondary,  new Emoji("📅"), row: 2)
            .WithButton(t.Get("freq.button.times"),        $"freq:times:{habitId}",        ButtonStyle.Secondary,  new Emoji("🔁"), row: 2)
            .Build();

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task BadIdAsync(Texts t) =>
        await RespondAsync(t.Get("common.retry.dash"), ephemeral: true);

    private async Task NotFoundAsync(Texts t) =>
        await RespondAsync(t.Get("common.not-found"), ephemeral: true);

    private static EmbedBuilder BuildShareEmbedBase(Texts t, Habit habit, int grace, string username, DateOnly today, IReadOnlySet<DateOnly> lowDays,
        bool showStreaks)
    {
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
                dots.Append(completed.Contains(d) ? "🟩"
                    : !HabitService.IsScheduledOn(habit, d) ? "▫️"
                    : HabitService.IsOpen(d, today) ? "⬜"
                    : "⬛");
            }
            rows.Add(dots.ToString());
        }
        var grid = string.Join("\n", rows);

        string titleLine, statsLine;

        if (habit.FrequencyType == FrequencyType.Weekly)
        {
            var (done, target) = HabitService.WeeklyProgress(habit, today);
            var total = habit.Logs.Count(l => l.Completed);
            titleLine = t.Format("habit.share.weekly.title", done, target);
            statsLine = t.Format("habit.share.weekly.stats", HabitService.FlexibleStreak(habit, today, 28), total);
        }
        else if (!showStreaks)
        {
            var last30 = HabitService.FlexibleStreak(habit, today, 30);
            titleLine = t.Format("habit.share.flexible.title", last30);
            statsLine = t.Format("habit.share.flexible.stats", last30, habit.Logs.Count(l => l.Completed));
        }
        else
        {
            var (streak, graceUsed) = HabitService.ConsecutiveStreak(habit, today, grace, lowDays);
            var best   = HabitService.BestStreak(habit, today, grace, lowDays);
            var last30 = HabitService.FlexibleStreak(habit, today, 30);
            var total  = habit.Logs.Count(l => l.Completed);
            var graceStr = graceUsed > 0 ? " " + t.Plural("habit.progress.grace", graceUsed) : "";
            var fireCount = Math.Min(streak / 7 + 1, 5);
            titleLine = $"{t.Format("habit.share.streak", streak)}{graceStr} {string.Concat(Enumerable.Repeat("🔥", fireCount))}";
            statsLine = t.Format("habit.share.streak.stats", last30, best, total);
        }

        return new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle($"🔥 {habit.Name} _({HabitModule.FrequencyLabel(t, habit)})_")
            .WithDescription($"{titleLine}\n\n{grid}\n\n{statsLine}")
            .WithFooter(t.Format("habit.share.footer", username))
            .WithTimestamp(DateTimeOffset.UtcNow);
    }

    internal static Embed BuildShareEmbed(Texts t, Habit habit, int grace, string username, DateOnly today, IReadOnlySet<DateOnly> lowDays,
        bool showStreaks) =>
        BuildShareEmbedBase(t, habit, grace, username, today, lowDays, showStreaks).Build();
}
