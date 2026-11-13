using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Core.Services;

namespace Ember.Bot.Modules;

[Group("privacy", "Control your privacy settings")]
public class PrivacyModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public PrivacyModule(HabitService habits)
    {
        _habits = habits;
    }

    [SlashCommand("delete", "Permanently delete all your Ember data")]
    public Task DeleteAsync() => RespondWithDeleteConfirmationAsync();

    [ComponentInteraction("privacy:delete:start:*", ignoreGroupNames: true)]
    public async Task OnStartDeleteAsync(string ownerIdStr)
    {
        if (!IsOwner(ownerIdStr, Context.User.Id))
        {
            await RespondAsync((await BotTexts.ForAsync(_habits, Context.Interaction)).Get("common.not-yours"), ephemeral: true);
            return;
        }

        await RespondWithDeleteConfirmationAsync();
    }

    private async Task RespondWithDeleteConfirmationAsync()
    {
        var userId = Context.User.Id;
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        var buttons = new ComponentBuilder()
            .WithButton(t.Get("privacy.delete.button"), $"privacy:delete:confirm:{userId}", ButtonStyle.Danger)
            .WithButton(t.Get("common.cancel"), $"privacy:delete:cancel:{userId}", ButtonStyle.Secondary)
            .Build();

        await RespondAsync(
            t.Get("privacy.delete.confirm"),
            components: buttons,
            ephemeral: true);
    }

    [ComponentInteraction("privacy:delete:confirm:*", ignoreGroupNames: true)]
    public async Task OnConfirmDeleteAsync(string ownerIdStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!await TryDeleteAsync(_habits, ownerIdStr, Context.User.Id))
        {
            await RespondAsync(t.Get("common.not-yours"), ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = t.Get("privacy.delete.done");
            m.Components = new ComponentBuilder().Build();
        });
    }

    [ComponentInteraction("privacy:delete:cancel:*", ignoreGroupNames: true)]
    public async Task OnCancelDeleteAsync(string ownerIdStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!IsOwner(ownerIdStr, Context.User.Id))
        {
            await RespondAsync(t.Get("common.not-yours"), ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = t.Get("privacy.delete.cancelled");
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
