using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// Lets a user whose DM reminders were paused (Discord refused the DMs) check that Ember can
/// reach them again. Custom ID: "dmretry:{discordUserId}".
/// </summary>
public class DmRetryModule : InteractionModuleBase<SocketInteractionContext>
{
    internal const string NoticeText =
        "Hey, I couldn't deliver your last few reminders by DM, so I've paused them for now. 💙\n" +
        "This usually happens when DMs from server members are turned off (server menu → Privacy Settings → Direct Messages). " +
        "Once they're on, tap below and I'll send you a quick test message.";

    private readonly HabitService _habits;
    private readonly IDiscordDmSender _discord;

    public DmRetryModule(HabitService habits, IDiscordDmSender discord)
    {
        _habits  = habits;
        _discord = discord;
    }

    internal static MessageComponent RetryButton(ulong userId) => new ComponentBuilder()
        .WithButton("Try again", $"dmretry:{userId}", ButtonStyle.Primary)
        .Build();

    [ComponentInteraction("dmretry:*")]
    public async Task OnRetryAsync(string userIdStr)
    {
        if (!ulong.TryParse(userIdStr, out var userId) || userId != Context.User.Id)
        {
            await RespondAsync("This button isn't for you.", ephemeral: true);
            return;
        }

        var outcome = await _discord.SendMessageAsync(userId,
            "Hi! This is Ember checking that I can reach you. Your reminders are back on. 🔥");

        if (outcome != DeliveryOutcome.Delivered)
        {
            await RespondAsync(
                "I still can't reach you by DM. No rush: once DMs are on, tap **Try again** whenever you like.",
                ephemeral: true);
            return;
        }

        await _habits.ResumeDmRemindersAsync(userId);
        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = "That worked! Your reminders are back on. 💙";
            m.Components = new ComponentBuilder().Build();
        });
    }
}
