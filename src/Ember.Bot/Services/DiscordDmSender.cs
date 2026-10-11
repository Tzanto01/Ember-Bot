using Discord;
using Discord.Net;
using Discord.WebSocket;

namespace Ember.Bot.Services;

public class DiscordDmSender : IDiscordDmSender
{
    private readonly DiscordSocketClient _client;

    public DiscordDmSender(DiscordSocketClient client)
    {
        _client = client;
    }

    public async Task<DeliveryOutcome> SendMessageAsync(
        ulong userId,
        string? text = null,
        Embed? embed = null,
        MessageComponent? components = null,
        CancellationToken cancellationToken = default)
    {
        var user = await _client.GetUserAsync(userId);
        if (user is null)
            return DeliveryOutcome.UserNotFound;

        try
        {
            var dm = await user.CreateDMChannelAsync();
            await dm.SendMessageAsync(text, embed: embed, components: components);
            return DeliveryOutcome.Delivered;
        }
        catch (HttpException ex) when (ex.DiscordCode == DiscordErrorCode.CannotSendMessageToUser)
        {
            return DeliveryOutcome.Undeliverable;
        }
    }
}
