using Ember.Bot.Services;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Quartz;

namespace Ember.Bot.Jobs;

/// <summary>
/// Runs every minute and sends every reminder whose <see cref="Habit.NextReminderUtc"/> is due,
/// then advances it to the next local occurrence of the habit's ReminderTime.
/// Reminders overdue by more than <see cref="StaleAfter"/> (e.g. after downtime) are advanced
/// without sending, as are habits paused or already completed on the user's local day.
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
    private readonly IReminderChannel _channel;
    private readonly ILogger<ReminderDispatchJob> _logger;
    private readonly TimeProvider _time;

    public ReminderDispatchJob(IServiceProvider services, IReminderChannel channel, ILogger<ReminderDispatchJob> logger, TimeProvider time)
    {
        _services = services;
        _channel  = channel;
        _logger   = logger;
        _time     = time;
    }

    public Task Execute(IJobExecutionContext context) => RunAsync(context.CancellationToken);

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        List<int> dueIds;
        using (var scope = _services.CreateScope())
        {
            dueIds = await scope.ServiceProvider.GetRequiredService<HabitService>()
                .GetDueReminderHabitIdsAsync(now, cancellationToken);
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
        // Reminders reach Discord users only; a web-only user's reminder advances unsent and never counts as a DM failure.
        var discordId = user.DiscordId();
        var send = discordId is not null
            && now - dueAt <= StaleAfter
            && user.DmRemindersPausedAt is null
            && !HabitService.IsPausedOn(habit, today)
            && !await habits.IsCompletedOnAsync(habit.Id, today, cancellationToken);

        if (send)
        {
            var weekAgo = today.AddDays(-7);
            var recent = await habits.CountCompletedBetweenAsync(habit.Id, weekAgo, today, cancellationToken);
            var snoozed = habit.ReminderTime is not { } time
                || TimezoneHelper.NextOccurrenceUtc(time, tz, dueAt.AddTicks(-1)) != dueAt;

            var outcome = await SendAsync(new Reminder(discordId!.Value, habit.Id, habit.Name, recent, snoozed), cancellationToken);
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

        habit.NextReminderUtc = habit.ReminderTime is { } reminderTime
            ? TimezoneHelper.NextOccurrenceUtc(reminderTime, tz, now)
            : null;
        await habits.SaveChangesAsync(send ? CancellationToken.None : cancellationToken);
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

    private async Task<DeliveryOutcome?> SendAsync(Reminder reminder, CancellationToken cancellationToken)
    {
        try
        {
            var outcome = await _channel.SendAsync(reminder, cancellationToken);
            if (outcome != DeliveryOutcome.Delivered)
                _logger.LogWarning("Reminder for habit {HabitId} to user {UserId} was not delivered: {Outcome}.",
                    reminder.HabitId, reminder.UserId, outcome);
            return outcome;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send reminder for habit {HabitId} to user {UserId}.", reminder.HabitId, reminder.UserId);
            return null;
        }
    }
}
