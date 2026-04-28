using Discord;

namespace Ember.Bot.Services;

public interface IDiscordDmSender
{
    Task<bool> SendMessageAsync(
        ulong userId,
        string? text = null,
        Embed? embed = null,
        MessageComponent? components = null,
        CancellationToken cancellationToken = default);
}
