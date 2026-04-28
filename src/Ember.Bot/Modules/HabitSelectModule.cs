using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Models;
using Ember.Bot.Services;

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
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(); return; }

        var components = new ComponentBuilder()
            .WithButton("✅ Done!", $"habitaction:checkin:done:{habitId}", ButtonStyle.Success)
            .WithButton("❌ Skipped today", $"habitaction:checkin:skip:{habitId}", ButtonStyle.Secondary)
            .Build();

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = $"How did **{habit.Name}** go today?";
                m.Components = components;
            });
    }

    // ── habit:select:share ────────────────────────────────────────────────────

    [ComponentInteraction("habit:select:share")]
    public async Task OnSelectShareAsync(string[] values)
    {
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        var grace = await _habits.GetGraceDaysAsync(Context.User.Id);

        if (habit is null) { await NotFoundAsync(); return; }

        var embed = BuildShareEmbed(habit, grace, Context.User.Username);
        var component = (SocketMessageComponent)Context.Interaction;

        // Acknowledge the component interaction first, then post publicly.
        await component.UpdateAsync(m =>
        {
            m.Content    = "Streak card posted! 🔥";
            m.Components = new ComponentBuilder().Build();
        });

        await Context.Channel.SendMessageAsync(embed: embed);
    }

    // ── habit:select:delete ───────────────────────────────────────────────────

    [ComponentInteraction("habit:select:delete")]
    public async Task OnSelectDeleteAsync(string[] values)
    {
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(); return; }

        var components = new ComponentBuilder()
            .WithButton("Yes, delete it", $"habitaction:delete:confirm:{habitId}", ButtonStyle.Danger)
            .WithButton("Cancel", "habitaction:delete:cancel", ButtonStyle.Secondary)
            .Build();

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = $"Are you sure you want to delete **{habit.Name}**? This can't be undone.";
                m.Components = components;
            });
    }

    // ── habit:select:edit ─────────────────────────────────────────────────────

    [ComponentInteraction("habit:select:edit")]
    public async Task OnSelectEditAsync(string[] values)
    {
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(); return; }

        var components = new ComponentBuilder()
            .WithButton("Rename",          $"habitaction:edit:rename:{habitId}",   ButtonStyle.Primary, new Emoji("✏️"))
            .WithButton("Change reminder", $"reminder:set:{habitId}",              ButtonStyle.Secondary, new Emoji("⏰"))
            .WithButton("Remove reminder", $"reminder:clear:{habitId}",            ButtonStyle.Danger)
            .WithButton("Cancel",          $"reminder:cancel:{habitId}",           ButtonStyle.Secondary)
            .Build();

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = $"What would you like to change about **{habit.Name}**?";
                m.Components = components;
            });
    }

    // ── habit:select:pause ────────────────────────────────────────────────────

    [ComponentInteraction("habit:select:pause")]
    public async Task OnSelectPauseAsync(string[] values)
    {
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(); return; }

        var isPaused = habit.PausedUntil.HasValue &&
                       habit.PausedUntil >= DateOnly.FromDateTime(DateTime.UtcNow);

        var builder = new ComponentBuilder()
            .WithButton("Today only", $"habitaction:pause:{habitId}:today",    ButtonStyle.Secondary)
            .WithButton("3 days",     $"habitaction:pause:{habitId}:3days",    ButtonStyle.Secondary)
            .WithButton("1 week",     $"habitaction:pause:{habitId}:1week",    ButtonStyle.Primary);

        if (isPaused)
            builder.WithButton("Resume now", $"habitaction:pause:{habitId}:resume", ButtonStyle.Success);

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = $"How long do you want to pause **{habit.Name}**?";
                m.Components = builder.Build();
            });
    }

    // ── habit:select:frequency ────────────────────────────────────────────────

    [ComponentInteraction("habit:select:frequency")]
    public async Task OnSelectFrequencyAsync(string[] values)
    {
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(); return; }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(); return; }

        var components = new ComponentBuilder()
            .WithButton("Daily",      $"habitaction:freq:{habitId}:daily",   ButtonStyle.Primary,    row: 0)
            .WithButton("1× / week",  $"freq:weekly:{habitId}:1",            ButtonStyle.Secondary,  row: 0)
            .WithButton("2× / week",  $"freq:weekly:{habitId}:2",            ButtonStyle.Secondary,  row: 0)
            .WithButton("3× / week",  $"freq:weekly:{habitId}:3",            ButtonStyle.Secondary,  row: 0)
            .WithButton("4× / week",  $"freq:weekly:{habitId}:4",            ButtonStyle.Secondary,  row: 0)
            .WithButton("5× / week",  $"freq:weekly:{habitId}:5",            ButtonStyle.Secondary,  row: 1)
            .WithButton("6× / week",  $"freq:weekly:{habitId}:6",            ButtonStyle.Secondary,  row: 1)
            .Build();

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = $"How often do you want to track **{habit.Name}**?";
                m.Components = components;
            });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task BadIdAsync() =>
        await RespondAsync("Something went wrong — please try again.", ephemeral: true);

    private async Task NotFoundAsync() =>
        await RespondAsync("Couldn't find that habit.", ephemeral: true);

    private static EmbedBuilder BuildShareEmbedBase(Habit habit, int grace, string username)
    {
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

        string titleLine, statsLine;

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
            var fireCount = Math.Min(streak / 7 + 1, 5);
            titleLine = $"**{streak}-day streak**{graceStr} {string.Concat(Enumerable.Repeat("🔥", fireCount))}";
            statsLine = $"Last 30 days: **{last30}/30** · Best ever: **{best}** · Total: **{total}**";
        }

        return new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle($"🔥 {habit.Name} _({HabitModule.FrequencyLabel(habit)})_")
            .WithDescription($"{titleLine}\n\n{grid}\n\n{statsLine}")
            .WithFooter($"Tracked by {username} via Ember 🔥")
            .WithTimestamp(DateTimeOffset.UtcNow);
    }

    internal static Embed BuildShareEmbed(Habit habit, int grace, string username) =>
        BuildShareEmbedBase(habit, grace, username).Build();
}
