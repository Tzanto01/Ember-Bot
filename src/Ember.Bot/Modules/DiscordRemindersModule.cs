using Ember.Core.Localization;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Core.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// The answer to "may your reminders come here by Discord DM?" (<see cref="Jobs.DiscordReminderAskJob"/>); the latest answer wins.
/// Custom IDs: "discordreminders:yes:{discordUserId}", "discordreminders:no:{discordUserId}".
/// </summary>
public class DiscordRemindersModule : InteractionModuleBase<SocketInteractionContext>
{
    internal static string AskText(Texts t) => t.Get("discordreminders.ask");

    /// <summary>The note, on its own line, that a reminder set from Discord won't come by DM because the user said no.</summary>
    internal static string OffText(Texts t) => "\n" + t.Get("discordreminders.off");

    private readonly HabitService _habits;

    public DiscordRemindersModule(HabitService habits)
    {
        _habits = habits;
    }

    internal static MessageComponent AskButtons(Texts t, ulong userId) => new ComponentBuilder()
        .WithButton(t.Get("discordreminders.ask.yes"), $"discordreminders:yes:{userId}", ButtonStyle.Primary)
        .WithButton(t.Get("discordreminders.ask.no"), $"discordreminders:no:{userId}", ButtonStyle.Secondary)
        .Build();

    internal static MessageComponent TurnOnButton(Texts t, ulong userId) => new ComponentBuilder()
        .WithButton(t.Get("discordreminders.turn-on"), $"discordreminders:yes:{userId}", ButtonStyle.Primary)
        .Build();

    /// <summary>Records the owner's answer only when the person clicking is that owner. Returns whether the clicker is the owner.</summary>
    internal static async Task<bool> TryAnswerAsync(HabitService habits, string ownerIdStr, ulong clickerId, bool yes)
    {
        if (!ulong.TryParse(ownerIdStr, out var ownerId) || ownerId != clickerId) return false;
        await habits.SetDiscordRemindersAsync(clickerId, yes);
        return true;
    }

    [ComponentInteraction("discordreminders:yes:*")]
    public Task OnYesAsync(string ownerIdStr) => AnswerAsync(ownerIdStr, yes: true);

    [ComponentInteraction("discordreminders:no:*")]
    public Task OnNoAsync(string ownerIdStr) => AnswerAsync(ownerIdStr, yes: false);

    private async Task AnswerAsync(string ownerIdStr, bool yes)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!await TryAnswerAsync(_habits, ownerIdStr, Context.User.Id, yes))
        {
            await RespondAsync(t.Get("common.not-yours"), ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content = t.Get(yes ? "discordreminders.yes" : "discordreminders.no");
            m.Components = yes ? new ComponentBuilder().Build() : TurnOnButton(t, Context.User.Id);
        });
    }
}
