using System.Globalization;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the ✅/❌/⏰ button interactions sent in DM reminders.
/// Custom ID format: "checkin:done:{habitId}:{unixSeconds}", "checkin:skip:{habitId}:{unixSeconds}", "checkin:snooze:{habitId}:{unixSeconds}"
/// Buttons never expire: done and skip log the user's local day the reminder was sent on.
/// </summary>
public class CheckInButtonModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public CheckInButtonModule(HabitService habits)
    {
        _habits = habits;
    }

    /// <summary>
    /// Logs the habit for the user's local day at <paramref name="timestampStr"/> (the reminder's send time, unix seconds),
    /// or for local today when the timestamp is malformed. Returns the edit result and the day it applied to.
    /// </summary>
    internal static async Task<(DayEditResult Result, DateOnly Day)> LogReminderDayAsync(
        HabitService habits, ulong userId, int habitId, string timestampStr, bool completed, ulong? guildId)
    {
        var day = long.TryParse(timestampStr, out var sentUnix) && sentUnix is >= 0 and <= 253402300799
            ? DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeSeconds(sentUnix), await habits.GetUserTzAsync(userId)).DateTime)
            : await habits.GetLocalTodayAsync(userId);
        return (await habits.CheckInAsync(userId, habitId, day, completed, guildId), day);
    }

    private async Task LogAsync(string habitIdStr, string timestampStr, bool completed, string todayText, string earlierText)
    {
        if (!int.TryParse(habitIdStr, out var habitId))
        {
            await RespondAsync("Something went wrong with that button.", ephemeral: true);
            return;
        }

        var (result, day) = await LogReminderDayAsync(_habits, Context.User.Id, habitId, timestampStr, completed, Context.Guild?.Id);
        switch (result)
        {
            case DayEditResult.Saved:
                break;
            case DayEditResult.BeforeHabitStart:
                await RespondAsync("That reminder is from before this habit started, so there's nothing to log for that day. 💙", ephemeral: true);
                return;
            case DayEditResult.InFuture:
                await RespondAsync("Something went wrong with that button.", ephemeral: true);
                return;
            default:
                await RespondAsync("Couldn't find that habit.", ephemeral: true);
                return;
        }

        var text = day == await _habits.GetLocalTodayAsync(Context.User.Id)
            ? todayText
            : string.Format(earlierText, day.ToString("dddd d MMM", CultureInfo.InvariantCulture));
        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(msg =>
        {
            msg.Content    = text;
            msg.Components = new ComponentBuilder().Build();
        });
    }

    [ComponentInteraction("checkin:done:*:*")]
    public async Task OnDoneAsync(string habitIdStr, string timestampStr) =>
        await LogAsync(habitIdStr, timestampStr, completed: true,
            "Logged! Great work today. ✅", "Logged for {0}. Great work. ✅");

    [ComponentInteraction("checkin:skip:*:*")]
    public async Task OnSkipAsync(string habitIdStr, string timestampStr) =>
        await LogAsync(habitIdStr, timestampStr, completed: false,
            "No worries — noted. Tomorrow's a fresh start. 💙", "No worries, noted for {0}. 💙");

    [ComponentInteraction("checkin:snooze:*:*")]
    public async Task OnSnoozeAsync(string habitIdStr, string timestampStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId))
        {
            await RespondAsync("Something went wrong with that button.", ephemeral: true);
            return;
        }

        if (!await _habits.SnoozeReminderAsync(Context.User.Id, habitId))
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        var component = (SocketMessageComponent)Context.Interaction;
        await component.UpdateAsync(msg =>
        {
            msg.Content    = "Got it — I'll nudge you again in 1 hour. 💤";
            msg.Components = new ComponentBuilder().Build();
        });
    }
}
