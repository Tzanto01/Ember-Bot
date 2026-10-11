using Discord;

namespace Ember.Bot.Services;

public interface IDiscordDmSender
{
    /// <summary>Sends a DM. Users who can't receive DMs from Ember yield <see cref="DeliveryOutcome.Undeliverable"/> instead of an exception.</summary>
    Task<DeliveryOutcome> SendMessageAsync(
        ulong userId,
        string? text = null,
        Embed? embed = null,
        MessageComponent? components = null,
        CancellationToken cancellationToken = default);
}
