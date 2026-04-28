using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the ✅/❌ button interactions sent in DM reminders.
/// Custom ID format: "checkin:done:{habitId}" or "checkin:skip:{habitId}"
/// </summary>
public class CheckInButtonModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public CheckInButtonModule(HabitService habits)
    {
        _habits = habits;
    }

    [ComponentInteraction("checkin:done:*")]
    public async Task OnDoneAsync(string habitIdStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId))
        {
            await RespondAsync("Something went wrong with that button.", ephemeral: true);
            return;
        }

        var log = await _habits.CheckInAsync(Context.User.Id, habitId, completed: true);
        if (log is null)
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        var component = (SocketMessageComponent)Context.Interaction;
        await component.UpdateAsync(msg =>
        {
            msg.Content    = "Logged! Great work today. ✅";
            msg.Components = new ComponentBuilder().Build();
        });
    }

    [ComponentInteraction("checkin:skip:*")]
    public async Task OnSkipAsync(string habitIdStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId))
        {
            await RespondAsync("Something went wrong with that button.", ephemeral: true);
            return;
        }

        var log = await _habits.CheckInAsync(Context.User.Id, habitId, completed: false);
        if (log is null)
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        var component = (SocketMessageComponent)Context.Interaction;
        await component.UpdateAsync(msg =>
        {
            msg.Content    = "No worries — noted. Tomorrow's a fresh start. 💙";
            msg.Components = new ComponentBuilder().Build();
        });
    }
}
