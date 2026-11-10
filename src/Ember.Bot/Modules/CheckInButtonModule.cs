using System.Globalization;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Jobs;
using Ember.Bot.Services;
using Ember.Core.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the ✅/❌/⏰ button interactions sent in DM reminders.
/// Custom ID format: "checkin:done:{habitId}:{unixSeconds}", "checkin:skip:{habitId}:{unixSeconds}", "checkin:snooze:{habitId}:{unixSeconds}"
/// Done and skip log the user's local day the reminder was sent on, until the reminder expires
/// (<see cref="ReminderDispatchJob.IsExpired"/>); after that they close the message instead.
/// Snooze only works within <see cref="HabitService.SnoozeWindow"/> of the send time.
/// A tap that removes a reminder's buttons forgets its <see cref="Core.Models.ReminderMessage"/>.
/// </summary>
public class CheckInButtonModule : InteractionModuleBase<SocketInteractionContext>
{
    private const string ExpiredText = "This reminder has closed. You can still fill in that day with /habit history or on the web. 💙";

    private readonly HabitService _habits;
    private readonly TimeProvider _time;

    public CheckInButtonModule(HabitService habits, TimeProvider time)
    {
        _habits = habits;
        _time = time;
    }

    /// <summary>The user's local day at <paramref name="timestampStr"/> (unix seconds), or null when the timestamp is malformed.</summary>
    private static async Task<DateOnly?> SentDayAsync(HabitService habits, ulong userId, string timestampStr)
        => long.TryParse(timestampStr, out var sentUnix) && sentUnix is >= 0 and <= 253402300799
            ? DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeSeconds(sentUnix), await habits.GetUserTzAsync(userId)).DateTime)
            : null;

    /// <summary>
    /// For a Done or Skip tap on a reminder sent at <paramref name="timestampStr"/>: null while the reminder is usable, otherwise the
    /// subtext its message closes with: <see cref="DiscordDmReminderChannel.LoggedLine"/> when every habit with a Done button in
    /// <paramref name="components"/> is done for that day, <see cref="DiscordDmReminderChannel.ClosedLine"/> otherwise.
    /// </summary>
    internal static async Task<string?> ExpiredLineAsync(HabitService habits, TimeProvider time, ulong userId, string timestampStr,
        IEnumerable<IMessageComponent> components)
    {
        if (await SentDayAsync(habits, userId, timestampStr) is not { } day
            || !ReminderDispatchJob.IsExpired(day, TimeZoneInfo.ConvertTime(time.GetUtcNow(), await habits.GetUserTzAsync(userId)).DateTime))
            return null;

        var habitIds = components.OfType<ActionRowComponent>().SelectMany(r => r.Components).OfType<ButtonComponent>()
            .Select(b => b.CustomId?.Split(':'))
            .Where(p => p is ["checkin", "done", _, _])
            .Select(p => int.TryParse(p![2], out var id) ? id : 0)
            .ToList();
        foreach (var habitId in habitIds)
            if ((await habits.GetHabitAsync(userId, habitId))?.Logs.Any(l => l.Date == day && l.Completed) != true)
                return DiscordDmReminderChannel.ClosedLine;
        return habitIds.Count > 0 ? DiscordDmReminderChannel.LoggedLine : DiscordDmReminderChannel.ClosedLine;
    }

    /// <summary>
    /// Logs the habit for the user's local day at <paramref name="timestampStr"/> (the reminder's send time, unix seconds),
    /// or for local today when the timestamp is malformed. Done adds one check-in (capped at the habit's times per day).
    /// A "not done" never overwrites a day already logged as done (<c>KeptDone</c>). Returns the edit result and the day it applied to.
    /// </summary>
    internal static async Task<(DayEditResult Result, DateOnly Day, bool KeptDone)> LogReminderDayAsync(
        HabitService habits, ulong userId, int habitId, string timestampStr, bool completed, ulong? guildId)
    {
        var day = await SentDayAsync(habits, userId, timestampStr) ?? await habits.GetLocalTodayAsync(userId);

        if (!completed && (await habits.GetHabitAsync(userId, habitId))?.Logs.Any(l => l.Date == day && (l.Completed || l.Count > 0)) == true)
            return (DayEditResult.Saved, day, true);

        return (completed
            ? await habits.AddCheckInAsync(userId, habitId, day, guildId)
            : await habits.CheckInAsync(userId, habitId, day, completed: false, guildId), day, false);
    }

    private async Task LogAsync(string habitIdStr, string timestampStr, bool completed, string todayText, string earlierText)
    {
        if (!int.TryParse(habitIdStr, out var habitId))
        {
            await RespondAsync("Something went wrong with that button.", ephemeral: true);
            return;
        }

        var component = (SocketMessageComponent)Context.Interaction;
        if (await ExpiredLineAsync(_habits, _time, Context.User.Id, timestampStr, component.Message.Components) is { } line)
        {
            await component.UpdateAsync(msg =>
            {
                msg.Content = $"{component.Message.Content}\n{line}";
                msg.Components = new ComponentBuilder().Build();
            });
            await FollowupAsync(ExpiredText, ephemeral: true);
            await _habits.DeleteReminderMessageByDiscordIdAsync(component.Message.Id);
            return;
        }

        var (result, day, keptDone) = await LogReminderDayAsync(_habits, Context.User.Id, habitId, timestampStr, completed, Context.Guild?.Id);
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

        var isToday = day == await _habits.GetLocalTodayAsync(Context.User.Id);
        var dayLabel = day.ToString("dddd d MMM", CultureInfo.InvariantCulture);
        var text = keptDone
            ? "You already checked in that day, so I've left it as it is. ✅"
            : isToday ? todayText : string.Format(earlierText, dayLabel);
        var habit = completed ? await _habits.GetHabitAsync(Context.User.Id, habitId) : null;
        if (completed)
            text = HabitModule.CheckInText(habit, day, text, isToday ? null : dayLabel);

        if (completed && RoutineButtonsAfterDone(component.Message.Components, component.Data.CustomId,
                habit?.Logs.Any(l => l.Date == day && l.Completed) == true) is { } remaining)
        {
            await component.UpdateAsync(msg => msg.Components = remaining);
            await FollowupAsync(text, ephemeral: true);
            return;
        }

        await component.UpdateAsync(msg =>
        {
            msg.Content    = text;
            msg.Components = new ComponentBuilder().Build();
        });
        await _habits.DeleteReminderMessageByDiscordIdAsync(component.Message.Id);
    }

    /// <summary>
    /// For a routine reminder (more than one Done button): the message's buttons after <paramref name="tappedId"/> was used, without it
    /// once its habit is done, so the other habits can still be logged. Null for a single-habit reminder.
    /// </summary>
    internal static MessageComponent? RoutineButtonsAfterDone(IEnumerable<IMessageComponent> components, string tappedId, bool done)
    {
        var buttons = components.OfType<ActionRowComponent>().SelectMany(r => r.Components).OfType<ButtonComponent>().ToList();
        if (buttons.Count(b => b.CustomId?.StartsWith("checkin:done:", StringComparison.Ordinal) == true) < 2) return null;

        var builder = new ComponentBuilder();
        var kept = buttons.Where(b => !done || b.CustomId != tappedId).ToList();
        for (var i = 0; i < kept.Count; i++) builder.WithButton(kept[i].ToBuilder(), i / 5);
        return builder.Build();
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
        if (!int.TryParse(habitIdStr, out var habitId)
            || !long.TryParse(timestampStr, out var sentUnix) || sentUnix is < 0 or > 253402300799)
        {
            await RespondAsync("Something went wrong with that button.", ephemeral: true);
            return;
        }

        if (!await _habits.SnoozeReminderAsync(Context.User.Id, habitId, DateTimeOffset.FromUnixTimeSeconds(sentUnix)))
        {
            await RespondAsync("This reminder isn't active anymore, so there's nothing to snooze. 💙", ephemeral: true);
            return;
        }

        var component = (SocketMessageComponent)Context.Interaction;
        await component.UpdateAsync(msg =>
        {
            msg.Content    = "Got it — I'll nudge you again in 1 hour. 💤";
            msg.Components = new ComponentBuilder().Build();
        });
        await _habits.DeleteReminderMessageByDiscordIdAsync(component.Message.Id);
    }
}
