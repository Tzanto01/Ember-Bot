using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Models;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the freq:weekly:{habitId}:{target} buttons shown after /habit frequency weekly.
/// </summary>
public class FrequencyButtonModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public FrequencyButtonModule(HabitService habits)
    {
        _habits = habits;
    }

    [ComponentInteraction("freq:weekly:*:*")]
    public async Task SetWeeklyTargetAsync(string habitIdStr, string targetStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId) || !int.TryParse(targetStr, out var target))
        {
            await RespondAsync("Something went wrong — try `/habit frequency` again.", ephemeral: true);
            return;
        }

        var habit = await _habits.SetFrequencyAsync(Context.User.Id, habitId, FrequencyType.Weekly, target);

        if (habit is null)
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = $"**{habit.Name}** set to **{target}× per week** — check in any days you choose.";
                m.Components = new ComponentBuilder().Build();
            });
    }
}
