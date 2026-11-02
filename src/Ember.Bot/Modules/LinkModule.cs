using Discord.Interactions;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

/// <summary>Points the user to the web app's settings, where they link their Discord account.</summary>
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
            ? "Want your habits in the browser too? 💙 Sign in to the Ember web app and link Discord in your settings:\n" +
              $"{origin.TrimEnd('/')}/settings\n\nNo codes needed. Your habits here come along."
            : NotAvailableText;

    [SlashCommand("link", "Link your Discord account with the Ember web app")]
    public async Task LinkAsync()
        => await RespondAsync(ReplyText(_config), ephemeral: true);
}
