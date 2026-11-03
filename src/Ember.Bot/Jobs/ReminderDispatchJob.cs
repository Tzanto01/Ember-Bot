using Ember.Bot.Services;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Quartz;

namespace Ember.Bot.Jobs;

/// <summary>
/// Runs every minute and sends every reminder whose <see cref="Habit.NextReminderUtc"/> is due once to each of the habit's
/// <see cref="Habit.ReminderChannels"/> the user can receive (Discord: a Discord login and DM reminders not paused;
/// web push: the channel is registered and the user has push subscriptions), then advances it once to the next local
/// occurrence of the habit's ReminderTime. Only the Discord outcome counts towards the DM pause.
/// <see cref="ReminderChannels.Mobile"/> is never sent from here (no <see cref="IReminderChannel"/> exists for it): the
/// native app schedules those reminders as local notifications on the device.
/// Reminders overdue by more than <see cref="StaleAfter"/> (e.g. after downtime) are advanced
/// without sending, as are habits paused or already completed on the user's local day, and habits in a routine that has a
/// reminder (the routine's reminder replaces theirs). A due <see cref="Routine"/> reminder is sent the same way, once, listing
/// the member habits still pending or partial on the user's local day, and advanced without sending when there are none.
/// After <see cref="MaxConsecutiveDmFailures"/> undeliverable reminders in a row the user's
/// reminders pause (still advanced, not sent) until they confirm Ember can reach them again.
/// </summary>
[DisallowConcurrentExecution]
public class ReminderDispatchJob : IJob
{
    public static readonly JobKey Key = new("reminder-dispatch", "reminders");

    public static readonly TimeSpan StaleAfter = TimeSpan.FromHours(2);

    /// <summary>Undeliverable reminders in a row after which a user's DM reminders pause.</summary>
    public const int MaxConsecutiveDmFailures = 3;

    private readonly IServiceProvider _services;
    private readonly IReadOnlyList<IReminderChannel> _channels;
    private readonly ILogger<ReminderDispatchJob> _logger;
    private readonly TimeProvider _time;

    public ReminderDispatchJob(IServiceProvider services, IEnumerable<IReminderChannel> channels, ILogger<ReminderDispatchJob> logger, TimeProvider time)
    {
        _services = services;
        _channels = channels.DistinctBy(c => c.Channel).ToList();
        _logger   = logger;
        _time     = time;
    }

    public Task Execute(IJobExecutionContext context) => RunAsync(context.CancellationToken);

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        List<int> dueIds, dueRoutineIds;
        using (var scope = _services.CreateScope())
        {
            var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
            dueIds = await habits.GetDueReminderHabitIdsAsync(now, cancellationToken);
            dueRoutineIds = await habits.GetDueReminderRoutineIdsAsync(now, cancellationToken);
        }

        foreach (var habitId in dueIds)
        {
            if (cancellationToken.IsCancellationRequested) return;
            try
            {
                await ProcessAsync(habitId, now, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Reminder for habit {HabitId} failed; retrying in a day.", habitId);
                await DeferAsync(habitId, now.AddDays(1), cancellationToken);
            }
        }

        foreach (var routineId in dueRoutineIds)
        {
            if (cancellationToken.IsCancellationRequested) return;
            try
            {
                await ProcessRoutineAsync(routineId, now, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Reminder for routine {RoutineId} failed; retrying in a day.", routineId);
                await DeferRoutineAsync(routineId, now.AddDays(1), cancellationToken);
            }
        }
    }

    private async Task ProcessAsync(int habitId, DateTime now, CancellationToken cancellationToken)
    {
        using var scope = _services.CreateScope();
        var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
        var habit = await habits.GetHabitWithUserAsync(habitId, cancellationToken);
        if (habit?.NextReminderUtc is not { } dueAt || dueAt > now) return;

        var tz = TimezoneHelper.Find(habit.User.Timezone) ?? TimeZoneInfo.Utc;
        var today = TimezoneHelper.LocalToday(habit.User.Timezone, _time);

        var user = habit.User;
        var discordId = user.DiscordId();
        var targets = Targets(habit.ReminderChannels, user, discordId);
        var send = targets.Count > 0
            && habit.Routine?.ReminderTime is null
            && now - dueAt <= StaleAfter
            && !HabitService.IsPausedOn(habit, today)
            && HabitService.IsScheduledOn(habit, today)
            && !await habits.IsCompletedOnAsync(habit.Id, today, cancellationToken);

        if (send)
        {
            var weekAgo = today.AddDays(-7);
            var recent = await habits.CountCompletedBetweenAsync(habit.Id, weekAgo, today, cancellationToken);
            var snoozed = habit.ReminderTime is not { } time
                || TimezoneHelper.NextOccurrenceUtc(time, tz, dueAt.AddTicks(-1)) != dueAt;
            var reminder = new Reminder(user.Id, discordId, habit.Id, habit.Name, recent, snoozed);
            await DeliverAsync(targets, reminder, user, now, cancellationToken);
        }

        habit.NextReminderUtc = habit.ReminderTime is { } reminderTime
            ? TimezoneHelper.NextOccurrenceUtc(reminderTime, tz, now)
            : null;
        await habits.SaveChangesAsync(send ? CancellationToken.None : cancellationToken);
    }

    private async Task ProcessRoutineAsync(int routineId, DateTime now, CancellationToken cancellationToken)
    {
        using var scope = _services.CreateScope();
        var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
        var routine = await habits.GetRoutineWithUserAsync(routineId, cancellationToken);
        if (routine?.NextReminderUtc is not { } dueAt || dueAt > now) return;

        var user = routine.User;
        var tz = TimezoneHelper.Find(user.Timezone) ?? TimeZoneInfo.Utc;
        var today = TimezoneHelper.LocalToday(user.Timezone, _time);
        var discordId = user.DiscordId();
        var targets = Targets(routine.ReminderChannels, user, discordId);

        List<RoutineHabit> pending = [];
        if (targets.Count > 0 && now - dueAt <= StaleAfter)
        {
            var lowDays = await habits.GetLowDaysAsync(user.Id);
            pending = routine.Habits
                .OrderBy(h => h.RoutinePosition)
                .Where(h => HabitService.DayOn(h, today, today, tz, lowDays).State is DayState.Pending or DayState.Partial)
                .Select(h => new RoutineHabit(h.Id, h.Name))
                .ToList();
        }

        var send = pending.Count > 0;
        if (send)
            await DeliverAsync(targets, new Reminder(user.Id, discordId, routine.Id, routine.Name, 0, false, pending), user, now,
                cancellationToken);

        routine.NextReminderUtc = routine.ReminderTime is { } reminderTime
            ? TimezoneHelper.NextOccurrenceUtc(reminderTime, tz, now)
            : null;
        await habits.SaveChangesAsync(send ? CancellationToken.None : cancellationToken);
    }

    /// <summary>The registered channels among <paramref name="channels"/> that the user can receive.</summary>
    private List<IReminderChannel> Targets(ReminderChannels channels, User user, ulong? discordId)
        => _channels.Where(c => channels.HasFlag(c.Channel) && c.Channel switch
        {
            ReminderChannels.Discord => discordId is not null && user.DmRemindersPausedAt is null,
            ReminderChannels.WebPush => user.PushSubscriptions.Count > 0,
            _ => false,
        }).ToList();

    /// <summary>Sends the reminder to each target; the Discord outcome updates the user's DM failure count and pause.</summary>
    private async Task DeliverAsync(List<IReminderChannel> targets, Reminder reminder, User user, DateTime now,
        CancellationToken cancellationToken)
    {
        foreach (var channel in targets)
        {
            var outcome = await SendAsync(channel, reminder, cancellationToken);
            if (channel.Channel != ReminderChannels.Discord) continue;

            if (outcome == DeliveryOutcome.Delivered)
            {
                user.DmFailureCount = 0;
            }
            else if (outcome is not null && ++user.DmFailureCount >= MaxConsecutiveDmFailures)
            {
                user.DmRemindersPausedAt = now;
                _logger.LogWarning("Pausing DM reminders for user {UserId} after {Count} undeliverable reminders.",
                    user.Id, user.DmFailureCount);
            }
        }
    }

    private async Task DeferAsync(int habitId, DateTime until, CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<HabitService>()
                .DeferReminderAsync(habitId, until, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Could not defer the reminder for habit {HabitId}.", habitId);
        }
    }

    private async Task DeferRoutineAsync(int routineId, DateTime until, CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<HabitService>()
                .DeferRoutineReminderAsync(routineId, until, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Could not defer the reminder for routine {RoutineId}.", routineId);
        }
    }

    private async Task<DeliveryOutcome?> SendAsync(IReminderChannel channel, Reminder reminder, CancellationToken cancellationToken)
    {
        try
        {
            var outcome = await channel.SendAsync(reminder, cancellationToken);
            if (outcome != DeliveryOutcome.Delivered)
                _logger.LogWarning("{Channel} reminder for habit {HabitId} to user {UserId} was not delivered: {Outcome}.",
                    channel.Channel, reminder.HabitId, reminder.UserId, outcome);
            return outcome;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send {Channel} reminder for habit {HabitId} to user {UserId}.",
                channel.Channel, reminder.HabitId, reminder.UserId);
            return null;
        }
    }
}
