using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the ✅/❌/⏰ button interactions sent in DM reminders.
/// Custom ID format: "checkin:done:{habitId}", "checkin:skip:{habitId}", "checkin:snooze:{habitId}"
/// </summary>
public class CheckInButtonModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;
    private readonly ReminderScheduler _scheduler;

    public CheckInButtonModule(HabitService habits, ReminderScheduler scheduler)
    {
        _habits    = habits;
        _scheduler = scheduler;
    }

    [ComponentInteraction("checkin:done:*")]
    public async Task OnDoneAsync(string habitIdStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId))
        {
            await RespondAsync("Something went wrong with that button.", ephemeral: true);
            return;
        }

        var guildId = Context.Guild?.Id;
        var log = await _habits.CheckInAsync(Context.User.Id, habitId, completed: true, guildId);
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

        var guildId = Context.Guild?.Id;
        var log = await _habits.CheckInAsync(Context.User.Id, habitId, completed: false, guildId);
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

    [ComponentInteraction("checkin:snooze:*")]
    public async Task OnSnoozeAsync(string habitIdStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId))
        {
            await RespondAsync("Something went wrong with that button.", ephemeral: true);
            return;
        }

        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null)
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        await _scheduler.SnoozeAsync(habitId, habit.UserId, habit.Name, delayMinutes: 60);

        var component = (SocketMessageComponent)Context.Interaction;
        await component.UpdateAsync(msg =>
        {
            msg.Content    = "Got it — I'll nudge you again in 1 hour. 💤";
            msg.Components = new ComponentBuilder().Build();
        });
    }
}
