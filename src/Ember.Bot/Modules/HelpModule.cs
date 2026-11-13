using Discord;
using Discord.Interactions;
using Ember.Core.Localization;
using Ember.Core.Services;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

public class HelpModule : InteractionModuleBase<SocketInteractionContext>
{
    private const string PrivacyPath = "/legal/privacy";

    private readonly HabitService _habits;
    private readonly IConfiguration _config;

    public HelpModule(HabitService habits, IConfiguration config)
    {
        _habits = habits;
        _config = config;
    }

    [SlashCommand("help", "See everything Ember can do")]
    public async Task HelpAsync()
    {
        await RespondAsync(embed: HelpEmbed(await BotTexts.ForAsync(_habits, Context.Interaction), _config), ephemeral: true);
    }

    /// <summary>
    /// The command guide. With a configured privacy policy URL it ends with a link to it, plus an imprint link when that URL is
    /// the web app's <c>/legal/privacy</c> page (the web app serves the imprint at <c>/legal/imprint</c>).
    /// </summary>
    internal static Embed HelpEmbed(Texts t, IConfiguration config)
    {
        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle(t.Get("help.title"))
            .WithDescription(t.Get("help.description"));
        foreach (var section in new[] { "start", "daily", "manage", "share", "web", "privacy", "feedback" })
            embed.AddField(t.Get($"help.{section}.title"), t.Get($"help.{section}.body"), inline: false);
        embed.WithFooter(t.Get("help.footer"));

        if (config[ConsentModule.PolicyUrlKey] is { Length: > 0 } url)
        {
            var links = t.Format("help.legal.privacy", url);
            if (url.TrimEnd('/').EndsWith(PrivacyPath, StringComparison.OrdinalIgnoreCase))
                links += " · " + t.Format("help.legal.imprint", $"{url.TrimEnd('/')[..^PrivacyPath.Length]}/legal/imprint");
            embed.AddField(t.Get("help.legal.title"), links, inline: false);
        }

        return embed.Build();
    }
}
