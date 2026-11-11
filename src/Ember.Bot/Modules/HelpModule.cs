using Discord;
using Discord.Interactions;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

public class HelpModule : InteractionModuleBase<SocketInteractionContext>
{
    private const string PrivacyPath = "/legal/privacy";

    private readonly IConfiguration _config;

    public HelpModule(IConfiguration config)
    {
        _config = config;
    }

    [SlashCommand("help", "See everything Ember can do")]
    public async Task HelpAsync()
    {
        await RespondAsync(embed: HelpEmbed(_config), ephemeral: true);
    }

    /// <summary>
    /// The command guide. With a configured privacy policy URL it ends with a link to it, plus an imprint link when that URL is
    /// the web app's <c>/legal/privacy</c> page (the web app serves the imprint at <c>/legal/imprint</c>).
    /// </summary>
    internal static Embed HelpEmbed(IConfiguration config)
    {
        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle("Ember — Command Guide")
            .WithDescription("Low-pressure habit tracking. No guilt, no punishment — just progress.")
            .AddField("Getting started",
                "`/habit add` — create a new habit\n" +
                "`/habit template` — pick from pre-built habits\n" +
                "`/timezone set` — set your local timezone (needed for reminders)\n" +
                "`/timezone show` — see which timezone Ember uses for you",
                inline: false)
            .AddField("Daily use",
                "`/habit checkin` — log today's check-in\n" +
                "`/habit history` — fill in past days and mark low days\n" +
                "`/habit list` — see all habits + recent progress\n" +
                "`/habit streak` — view your personal stats",
                inline: false)
            .AddField("Managing habits",
                "`/habit edit` — rename or change reminder time\n" +
                "`/habit delete` — remove a habit\n" +
                "`/habit pause` — pause temporarily (streak protected)\n" +
                "`/habit frequency` — daily, weekly or set weekdays, and times per day\n" +
                "`/habit grace` — set how many flex days you get per week\n" +
                "`/habit second-reminder` — get one more nudge if you haven't checked in yet",
                inline: false)
            .AddField("Share",
                "`/habit share` — post a streak card in this channel",
                inline: false)
            .AddField("Web app",
                "`/link` — use Ember in your browser, or add Discord to an email account",
                inline: false)
            .AddField("Privacy",
                "`/export` — get your habits, check-ins and settings by DM\n" +
                "`/privacy delete` — permanently delete all your Ember data",
                inline: false)
            .WithFooter("Progress over perfection. Every check-in counts.");

        if (config[ConsentModule.PolicyUrlKey] is { Length: > 0 } url)
        {
            var links = $"[Privacy policy]({url})";
            if (url.TrimEnd('/').EndsWith(PrivacyPath, StringComparison.OrdinalIgnoreCase))
                links += $" · [Imprint]({url.TrimEnd('/')[..^PrivacyPath.Length]}/legal/imprint)";
            embed.AddField("Legal", links, inline: false);
        }

        return embed.Build();
    }
}
