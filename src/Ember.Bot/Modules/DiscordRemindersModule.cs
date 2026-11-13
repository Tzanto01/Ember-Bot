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

    internal const string OffText =
        "\nDiscord reminders are off for you, so I won't DM this one. You can turn them back on in Ember's Settings or with the button in my earlier message.";

    internal const string YesText =
        "Lovely, your reminders will come here too. 💙 You can change where Ember reminds you any time in Settings.";

    internal const string NoText =
        "No problem, I won't DM you your reminders. 💙 If you change your mind, tap below or turn on Discord DMs in Settings.";

    private readonly HabitService _habits;

    public DiscordRemindersModule(HabitService habits)
    {
        _habits = habits;
    }

    internal static MessageComponent AskButtons(Texts t, ulong userId) => new ComponentBuilder()
        .WithButton(t.Get("discordreminders.ask.yes"), $"discordreminders:yes:{userId}", ButtonStyle.Primary)
        .WithButton(t.Get("discordreminders.ask.no"), $"discordreminders:no:{userId}", ButtonStyle.Secondary)
        .Build();

    internal static MessageComponent TurnOnButton(ulong userId) => new ComponentBuilder()
        .WithButton("Turn them on", $"discordreminders:yes:{userId}", ButtonStyle.Primary)
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
        if (!await TryAnswerAsync(_habits, ownerIdStr, Context.User.Id, yes))
        {
            await RespondAsync("This button isn't for you.", ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content = yes ? YesText : NoText;
            m.Components = yes ? new ComponentBuilder().Build() : TurnOnButton(Context.User.Id);
        });
    }
}
