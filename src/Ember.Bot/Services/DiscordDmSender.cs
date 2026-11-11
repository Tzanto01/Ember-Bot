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
        => (await SendAsync(userId, text, embed, components)).Outcome;

    public Task<SentDm> SendTrackedMessageAsync(ulong userId, string text, MessageComponent components,
        CancellationToken cancellationToken = default)
        => SendAsync(userId, text, null, components);

    private async Task<SentDm> SendAsync(ulong userId, string? text, Embed? embed, MessageComponent? components)
    {
        var user = await _client.GetUserAsync(userId);
        if (user is null)
            return new SentDm(DeliveryOutcome.UserNotFound);

        try
        {
            var dm = await user.CreateDMChannelAsync();
            var message = await dm.SendMessageAsync(text, embed: embed, components: components);
            return new SentDm(DeliveryOutcome.Delivered, dm.Id, message.Id);
        }
        catch (HttpException ex) when (ex.DiscordCode == DiscordErrorCode.CannotSendMessageToUser)
        {
            return new SentDm(DeliveryOutcome.Undeliverable);
        }
    }

    public async Task<bool> CloseMessageAsync(ulong channelId, ulong messageId, string line, CancellationToken cancellationToken = default)
    {
        try
        {
            if (await _client.GetChannelAsync(channelId) is not IMessageChannel channel
                || await channel.GetMessageAsync(messageId) is not IUserMessage message)
                return false;

            await message.ModifyAsync(p =>
            {
                p.Content = $"{message.Content}\n{line}";
                p.Components = new ComponentBuilder().Build();
            });
            return true;
        }
        catch (HttpException)
        {
            return false;
        }
    }

    public async Task<bool> DeleteMessageAsync(ulong channelId, ulong messageId, CancellationToken cancellationToken = default)
    {
        try
        {
            if (await _client.GetChannelAsync(channelId) is not IMessageChannel channel) return false;
            await channel.DeleteMessageAsync(messageId);
            return true;
        }
        catch (HttpException)
        {
            return false;
        }
    }
}
