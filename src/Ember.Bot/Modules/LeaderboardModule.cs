using Discord;
using Discord.Interactions;
using Ember.Core.Services;

namespace Ember.Bot.Modules;

public class LeaderboardModule : InteractionModuleBase<SocketInteractionContext>
{
    internal const string OptedInText =
        "You're on the leaderboard now. In servers where you check in, it shows your display name " +
        "and how many check-ins you logged in the last 7 days.\n" +
        "Change your mind any time with `/privacy optout`.";

    internal const string OptedOutText =
        "You're off the leaderboard. Your check-ins still count for your own stats.\n" +
        "Use `/privacy optin` if you ever want to join.";

    private const string NameFallback = "A server member";

    private readonly HabitService _habits;

    public LeaderboardModule(HabitService habits)
    {
        _habits = habits;
    }

    // ── /leaderboard ──────────────────────────────────────────────────────────

    [SlashCommand("leaderboard", "See which opted-in members checked in most over the last 7 days")]
    public async Task LeaderboardAsync()
    {
        if (Context.Guild is null)
        {
            await RespondAsync(
                "Leaderboards are only available in a server — they show opted-in members who checked in there.",
                ephemeral: true);
            return;
        }

        var rows = await _habits.GetLeaderboardAsync(Context.Guild.Id, top: 10);

        var components = new ComponentBuilder()
            .WithButton("Join the leaderboard", "leaderboard:optin", ButtonStyle.Primary, new Emoji("🔥"))
            .WithButton("Leave it", "leaderboard:optout", ButtonStyle.Secondary, new Emoji("🙈"))
            .Build();

        if (rows.Count == 0)
        {
            await RespondAsync(
                "Nobody on the leaderboard has checked in here in the last 7 days. " +
                "It's opt-in, so join if you'd like to show up.",
                components: components,
                ephemeral: true);
            return;
        }

        await DeferAsync(ephemeral: false);

        var medals = new[] { "🥇", "🥈", "🥉" };
        var lines  = new List<string>();
        for (var i = 0; i < rows.Count; i++)
        {
            var rank  = i < medals.Length ? medals[i] : $"**{i + 1}.**";
            var count = rows[i].CheckIns == 1 ? "1 check-in" : $"{rows[i].CheckIns} check-ins";
            lines.Add($"{rank} {await DisplayNameAsync(rows[i].DiscordUserId)} — {count}");
        }

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle("🔥 Leaderboard · last 7 days")
            .WithDescription(string.Join("\n", lines))
            .WithFooter("Opt-in only · Rolling 7 days · Leave any time with /privacy optout")
            .WithTimestamp(DateTimeOffset.UtcNow)
            .Build();

        await FollowupAsync(embed: embed, components: components);
    }

    private async Task<string> DisplayNameAsync(ulong userId)
    {
        try
        {
            var member = await ((IGuild)Context.Guild).GetUserAsync(userId);
            return member is null ? NameFallback : Format.Sanitize(member.DisplayName);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return NameFallback;
        }
    }

    // ── leaderboard:optin / leaderboard:optout buttons ────────────────────────

    [ComponentInteraction("leaderboard:optin")]
    public async Task OnOptInButtonAsync()
    {
        await _habits.SetLeaderboardOptInAsync(Context.User.Id, true);
        await RespondAsync(OptedInText, ephemeral: true);
    }

    [ComponentInteraction("leaderboard:optout")]
    public async Task OnOptOutButtonAsync()
    {
        await _habits.SetLeaderboardOptInAsync(Context.User.Id, false);
        await RespondAsync(OptedOutText, ephemeral: true);
    }
}
