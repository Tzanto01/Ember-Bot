using System.Resources;
using Discord;
using Ember.Core.Localization;
using Ember.Core.Services;

namespace Ember.Bot;

/// <summary>
/// The bot's texts: <c>Resources/Bot.resx</c> (commands, buttons, modals), <c>Resources/Notifications.resx</c> (reminders,
/// summaries and other DMs the bot starts) and the shared <see cref="Texts.CoreResources"/>.
/// </summary>
internal static class BotTexts
{
    private static readonly ResourceManager BotResources = new("Ember.Bot.Resources.Bot", typeof(BotTexts).Assembly);
    private static readonly ResourceManager NotificationResources = new("Ember.Bot.Resources.Notifications", typeof(BotTexts).Assembly);

    /// <summary>The bot's texts in <paramref name="language"/> (English for anything that isn't <c>de</c>).</summary>
    public static Texts For(string? language)
        => new(language ?? Languages.English, BotResources, NotificationResources, Texts.CoreResources);

    /// <summary>The bot's texts in English.</summary>
    public static readonly Texts English = For(Languages.English);

    /// <summary>The texts for whoever started <paramref name="interaction"/>: their account's language, else their Discord locale.</summary>
    public static async Task<Texts> ForAsync(HabitService habits, IDiscordInteraction interaction)
        => For(await habits.GetDiscordLanguageAsync(interaction.User.Id, interaction.UserLocale));
}
