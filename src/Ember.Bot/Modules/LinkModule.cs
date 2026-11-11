using Discord.Interactions;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

/// <summary>
/// Points the user to the web app: "Sign in with Discord" opens the same account the bot uses, and linking Discord in the settings
/// of an email account offers to move the habits from here into that account.
/// </summary>
public class LinkModule : InteractionModuleBase<SocketInteractionContext>
{
    internal const string WebOriginKey = "Ember:WebOrigin";

    internal const string NotAvailableText =
        "Linking with the Ember web app isn't available yet. 💙 Your habits here keep working just as they are.";

    private readonly IConfiguration _config;

    public LinkModule(IConfiguration config)
    {
        _config = config;
    }

    internal static string ReplyText(IConfiguration config)
        => config[WebOriginKey] is { Length: > 0 } origin
            ? $"Your habits are already in the Ember web app. 💙 Open {origin.TrimEnd('/')} and choose **Sign in with Discord**.\n\n" +
              "Want to sign in with email and password too, or already have an Ember account with an email? " +
              $"Sign in with that account and link Discord in Settings: {origin.TrimEnd('/')}/settings\n" +
              "Ember then offers to move your habits from here into that account. No codes needed."
            : NotAvailableText;

    [SlashCommand("link", "Use Ember in your browser, or link Discord to an email account")]
    public async Task LinkAsync()
        => await RespondAsync(ReplyText(_config), ephemeral: true);
}
