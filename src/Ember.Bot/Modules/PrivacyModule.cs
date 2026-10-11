using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

[Group("privacy", "Control your privacy settings")]
public class PrivacyModule : InteractionModuleBase<SocketInteractionContext>
{
    private const string NotYourButton = "This button isn't for you.";

    private readonly HabitService _habits;

    public PrivacyModule(HabitService habits)
    {
        _habits = habits;
    }

    [SlashCommand("optout", "Leave all leaderboards")]
    public async Task OptOutAsync()
    {
        await _habits.SetLeaderboardOptInAsync(Context.User.Id, false);
        await RespondAsync(LeaderboardModule.OptedOutText, ephemeral: true);
    }

    [SlashCommand("optin", "Join leaderboards (you're off them by default)")]
    public async Task OptInAsync()
    {
        await _habits.SetLeaderboardOptInAsync(Context.User.Id, true);
        await RespondAsync(LeaderboardModule.OptedInText, ephemeral: true);
    }

    [SlashCommand("delete", "Permanently delete all your Ember data")]
    public async Task DeleteAsync()
    {
        var userId = Context.User.Id;
        var buttons = new ComponentBuilder()
            .WithButton("Delete everything", $"privacy:delete:confirm:{userId}", ButtonStyle.Danger)
            .WithButton("Cancel", $"privacy:delete:cancel:{userId}", ButtonStyle.Secondary)
            .Build();

        await RespondAsync(
            "This permanently deletes everything Ember knows about you: all your habits, every check-in, " +
            "your reminders and your settings. It can't be undone.\n\nWant to go ahead?",
            components: buttons,
            ephemeral: true);
    }

    [ComponentInteraction("privacy:delete:confirm:*", ignoreGroupNames: true)]
    public async Task OnConfirmDeleteAsync(string ownerIdStr)
    {
        if (!await TryDeleteAsync(_habits, ownerIdStr, Context.User.Id))
        {
            await RespondAsync(NotYourButton, ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = "Done. All your Ember data has been deleted. If you ever want to start fresh, I'll be here. 💙";
            m.Components = new ComponentBuilder().Build();
        });
    }

    [ComponentInteraction("privacy:delete:cancel:*", ignoreGroupNames: true)]
    public async Task OnCancelDeleteAsync(string ownerIdStr)
    {
        if (!IsOwner(ownerIdStr, Context.User.Id))
        {
            await RespondAsync(NotYourButton, ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = "No problem, nothing was deleted.";
            m.Components = new ComponentBuilder().Build();
        });
    }

    /// <summary>Deletes the owner's data only when the person clicking is that owner. Returns whether it deleted.</summary>
    internal static async Task<bool> TryDeleteAsync(HabitService habits, string ownerIdStr, ulong clickerId)
    {
        if (!IsOwner(ownerIdStr, clickerId)) return false;
        await habits.DeleteUserDataAsync(clickerId);
        return true;
    }

    private static bool IsOwner(string ownerIdStr, ulong clickerId)
        => ulong.TryParse(ownerIdStr, out var ownerId) && ownerId == clickerId;
}
