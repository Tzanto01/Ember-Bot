using Discord;
using Discord.Interactions;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

public class LeaderboardModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public LeaderboardModule(HabitService habits)
    {
        _habits = habits;
    }

    // ── /leaderboard ──────────────────────────────────────────────────────────

    [SlashCommand("leaderboard", "See who's been most consistent this week in this server")]
    public async Task LeaderboardAsync()
    {
        if (Context.Guild is null)
        {
            await RespondAsync(
                "Leaderboards are only available in a server — they show members who checked in here this week.",
                ephemeral: true);
            return;
        }

        await DeferAsync(ephemeral: false);

        var rows = await _habits.GetLeaderboardAsync(Context.Guild.Id, top: 10);

        if (rows.Count == 0)
        {
            await FollowupAsync(
                "No check-ins logged in this server yet this week. Be the first — use `/habit checkin`!",
                ephemeral: true);
            return;
        }

        var medals = new[] { "🥇", "🥈", "🥉" };
        var lines  = rows.Select((r, i) =>
        {
            var rank  = i < medals.Length ? medals[i] : $"**{i + 1}.**";
            var count = r.CheckIns == 1 ? "1 check-in" : $"{r.CheckIns} check-ins";
            return $"{rank} {r.DisplayName} — {count}";
        });

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle("🔥 This Week's Leaderboard")
            .WithDescription(string.Join("\n", lines))
            .WithFooter("Opt out any time with /privacy optout · Resets each Monday")
            .WithTimestamp(DateTimeOffset.UtcNow)
            .Build();

        var components = new ComponentBuilder()
            .WithButton("Opt me out", "leaderboard:optout", ButtonStyle.Secondary, new Emoji("🙈"))
            .Build();

        await FollowupAsync(embed: embed, components: components);
    }

    // ── leaderboard:optout button ─────────────────────────────────────────────

    [ComponentInteraction("leaderboard:optout")]
    public async Task OnOptOutButtonAsync()
    {
        await _habits.SetLeaderboardOptOutAsync(Context.User.Id, true);
        await RespondAsync(
            "Done — you're opted out. Your name won't appear on any leaderboard.\n" +
            "Use `/privacy optin` to come back any time.",
            ephemeral: true);
    }
}
