using Discord.Interactions;
using Discord.WebSocket;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the "That's ok, move on" dismiss button from MissedDayReflectionJob DMs.
/// Custom ID: reflect:dismiss:{userId}
/// </summary>
public class ReflectDismissModule : InteractionModuleBase<SocketInteractionContext>
{
    [ComponentInteraction("reflect:dismiss:*")]
    public async Task DismissAsync(string userId)
    {
        await RespondAsync("Noted. Today is a fresh start. 💙", ephemeral: true);

        // Delete the original DM message so the user's DMs stay clean.
        try
        {
            if (Context.Interaction is SocketMessageComponent component)
                await component.Message.DeleteAsync();
        }
        catch { /* Message may already be gone */ }
    }
}
