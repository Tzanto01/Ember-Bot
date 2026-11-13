using Ember.Core.Localization;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Services;
using Ember.Core.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// Lets a user whose DM reminders were paused (Discord refused the DMs) check that Ember can
/// reach them again. Custom ID: "dmretry:{discordUserId}".
/// </summary>
public class DmRetryModule : InteractionModuleBase<SocketInteractionContext>
{
    internal static string NoticeText(Texts t) => t.Get("dmretry.notice");

    private readonly HabitService _habits;
    private readonly IDiscordDmSender _discord;

    public DmRetryModule(HabitService habits, IDiscordDmSender discord)
    {
        _habits  = habits;
        _discord = discord;
    }

    internal static MessageComponent RetryButton(Texts t, ulong userId) => new ComponentBuilder()
        .WithButton(t.Get("dmretry.try-again"), $"dmretry:{userId}", ButtonStyle.Primary)
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
