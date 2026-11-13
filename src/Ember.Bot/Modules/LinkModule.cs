using Discord.Interactions;
using Ember.Core.Localization;
using Ember.Core.Services;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

/// <summary>
/// Points the user to the web app: "Sign in with Discord" opens the same account the bot uses, and linking Discord in the settings
/// of an email account offers to move the habits from here into that account.
/// </summary>
public class LinkModule : InteractionModuleBase<SocketInteractionContext>
{
    internal const string WebOriginKey = "Ember:WebOrigin";

    private readonly HabitService _habits;
    private readonly IConfiguration _config;

    public LinkModule(HabitService habits, IConfiguration config)
    {
        _habits = habits;
        _config = config;
    }

    internal static string ReplyText(Texts t, IConfiguration config)
        => config[WebOriginKey] is { Length: > 0 } origin
            ? t.Format("link.reply", origin.TrimEnd('/'))
            : t.Get("link.not-available");

    [SlashCommand("link", "Use Ember in your browser, or link Discord to an email account")]
    public async Task LinkAsync()
        => await RespondAsync(ReplyText(await BotTexts.ForAsync(_habits, Context.Interaction), _config), ephemeral: true);
}
