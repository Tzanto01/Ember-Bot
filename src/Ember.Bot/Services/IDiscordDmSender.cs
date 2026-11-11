using Discord;

namespace Ember.Bot.Services;

/// <summary>The outcome of a DM send and, when delivered, the DM channel and message it created.</summary>
public sealed record SentDm(DeliveryOutcome Outcome, ulong ChannelId = 0, ulong MessageId = 0);

public interface IDiscordDmSender
{
    /// <summary>Sends a DM. Users who can't receive DMs from Ember yield <see cref="DeliveryOutcome.Undeliverable"/> instead of an exception.</summary>
    Task<DeliveryOutcome> SendMessageAsync(
        ulong userId,
        string? text = null,
        Embed? embed = null,
        MessageComponent? components = null,
        CancellationToken cancellationToken = default);

    /// <summary>Like <see cref="SendMessageAsync"/>, also returning the ids of the sent message.</summary>
    Task<SentDm> SendTrackedMessageAsync(
        ulong userId,
        string text,
        MessageComponent components,
        CancellationToken cancellationToken = default);

    /// <summary>Removes every button of the message and appends <paramref name="line"/> to its text. False when Discord refused or the message is gone.</summary>
    Task<bool> CloseMessageAsync(ulong channelId, ulong messageId, string line, CancellationToken cancellationToken = default);

    /// <summary>Deletes the message. False when Discord refused or the message is gone.</summary>
    Task<bool> DeleteMessageAsync(ulong channelId, ulong messageId, CancellationToken cancellationToken = default);
}
