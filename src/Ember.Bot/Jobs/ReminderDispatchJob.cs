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
/// A reminder that no channel delivered because a send failed transiently (timeout, 5xx, 429, network), or a first or routine
/// reminder whose processing threw, stays due and is retried up to <see cref="ReminderRetries.MaxAttempts"/> attempts in all, <see cref="ReminderRetries.Spacing"/> apart;
/// after that it moves to its next reminder time and, for a Discord send, counts once towards the DM pause.
/// A delivered regular (not snoozed) reminder schedules one second reminder <see cref="User.SecondReminderMinutes"/> later when that
/// is on and falls on the same local day; it is sent like the first only if the day is still open then, and never followed by another.
/// Each run then closes the open Discord reminder messages whose habits are done for their day, or whose buttons expired
/// (<see cref="IsExpired"/>).
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
    private readonly IDiscordDmSender _discord;
    private readonly ILogger<ReminderDispatchJob> _logger;
    private readonly TimeProvider _time;
    private readonly ReminderRetries _retries;

    private const string HabitKind = "habit", RoutineKind = "routine", SecondHabitKind = "second-habit", SecondRoutineKind = "second-routine";

    private enum Delivery { Delivered, NotDelivered, Retry }

    public ReminderDispatchJob(IServiceProvider services, IEnumerable<IReminderChannel> channels, IDiscordDmSender discord,
        ILogger<ReminderDispatchJob> logger, TimeProvider time, ReminderRetries retries)
    {
        _retries  = retries;
        _services = services;
        _channels = channels.DistinctBy(c => c.Channel).ToList();
        _discord = discord;
        _logger   = logger;
        _time     = time;
    }

    /// <summary>
    /// True once a reminder for the local <paramref name="day"/> can no longer be used: from <see cref="MissedDayReflectionJob.LocalSendHour"/>:00
    /// local time on the next day, when the "Log yesterday" check-in takes over.
    /// </summary>
    public static bool IsExpired(DateOnly day, DateTime localNow)
        => localNow >= day.AddDays(1).ToDateTime(new TimeOnly(MissedDayReflectionJob.LocalSendHour, 0));

    public Task Execute(IJobExecutionContext context) => RunAsync(context.CancellationToken);

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        _retries.Prune(now);
        List<(int Id, DateTime DueAt)> dueHabits, dueRoutines;
        List<int> dueSecondIds, dueSecondRoutineIds;
        using (var scope = _services.CreateScope())
        {
            var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
            dueHabits = await habits.GetDueReminderHabitsAsync(now, cancellationToken);
            dueRoutines = await habits.GetDueReminderRoutinesAsync(now, cancellationToken);
            dueSecondIds = await habits.GetDueSecondReminderHabitIdsAsync(now, cancellationToken);
            dueSecondRoutineIds = await habits.GetDueSecondReminderRoutineIdsAsync(now, cancellationToken);
        }

        foreach (var habitId in dueSecondIds)
        {
            if (cancellationToken.IsCancellationRequested) return;
            try
            {
                await ProcessSecondAsync(habitId, now, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Second reminder for habit {HabitId} failed; dropping it.", habitId);
                await ClearSecondAsync(habits => habits.ClearSecondReminderAsync(habitId, cancellationToken));
            }
        }

        foreach (var routineId in dueSecondRoutineIds)
        {
            if (cancellationToken.IsCancellationRequested) return;
            try
            {
                await ProcessRoutineSecondAsync(routineId, now, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Second reminder for routine {RoutineId} failed; dropping it.", routineId);
                await ClearSecondAsync(habits => habits.ClearRoutineSecondReminderAsync(routineId, cancellationToken));
            }
        }

        foreach (var (habitId, dueAt) in dueHabits)
        {
            if (cancellationToken.IsCancellationRequested) return;
            if (!_retries.CanAttempt(HabitKind, habitId, dueAt, now)) continue;
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
                if (!_retries.Fail(HabitKind, habitId, dueAt, now))
                {
                    _logger.LogError(ex, "Reminder for habit {HabitId} failed; retrying later.", habitId);
                    continue;
                }
                _logger.LogError(ex, "Reminder for habit {HabitId} failed again; moving it to its next reminder time.", habitId);
                await DeferAsync(habitId, now, cancellationToken);
            }
        }

        foreach (var (routineId, dueAt) in dueRoutines)
        {
            if (cancellationToken.IsCancellationRequested) return;
            if (!_retries.CanAttempt(RoutineKind, routineId, dueAt, now)) continue;
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
                if (!_retries.Fail(RoutineKind, routineId, dueAt, now))
                {
                    _logger.LogError(ex, "Reminder for routine {RoutineId} failed; retrying later.", routineId);
                    continue;
                }
                _logger.LogError(ex, "Reminder for routine {RoutineId} failed again; moving it to its next reminder time.", routineId);
                await DeferRoutineAsync(routineId, now, cancellationToken);
            }
        }

        await CloseReminderMessagesAsync(cancellationToken);
    }

    /// <summary>
    /// Closes each open Discord reminder message whose habits are done for its day (<see cref="DiscordDmReminderChannel.LoggedLine"/>)
    /// or whose buttons expired (<see cref="DiscordDmReminderChannel.ClosedLine"/>), and forgets it, also when Discord can't edit it.
    /// </summary>
    private async Task CloseReminderMessagesAsync(CancellationToken cancellationToken)
    {
        List<(ReminderMessage Message, string Timezone, bool HabitDone)> open;
        using (var scope = _services.CreateScope())
            open = await scope.ServiceProvider.GetRequiredService<HabitService>().GetOpenReminderMessagesAsync(cancellationToken);

        foreach (var (message, timezone, habitDone) in open)
        {
            if (cancellationToken.IsCancellationRequested) return;
            var expired = IsExpired(message.Date, TimezoneHelper.LocalNow(timezone, _time).DateTime);
            if (message.HabitId is not null && !habitDone && !expired) continue;
            try
            {
                using var scope = _services.CreateScope();
                var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
                var done = message.HabitId is not null ? habitDone : await IsRoutineDoneAsync(habits, message, cancellationToken);
                if (!done && !expired) continue;

                await _discord.CloseMessageAsync(message.ChannelId, message.MessageId,
                    done ? DiscordDmReminderChannel.LoggedLine : DiscordDmReminderChannel.ClosedLine, cancellationToken);
                await habits.DeleteReminderMessageAsync(message.Id, CancellationToken.None);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not close reminder message {ReminderMessageId}.", message.Id);
            }
        }
    }

    /// <summary>True when the routine still has members and every one of them is done on the message's day.</summary>
    private static async Task<bool> IsRoutineDoneAsync(HabitService habits, ReminderMessage message, CancellationToken cancellationToken)
        => message.RoutineId is { } routineId
            && await habits.GetRoutineWithUserAsync(routineId, cancellationToken) is { Habits.Count: > 0 } routine
            && routine.Habits.All(h => h.Logs.Any(l => l.Date == message.Date && l.Completed));

    /// <summary>
    /// Sends the habit's due second reminder when the setting is on, the reminder isn't stale, the local day is the first reminder's,
    /// and the habit is still not done, not paused and scheduled today; then drops it either way.
    /// </summary>
    private async Task ProcessSecondAsync(int habitId, DateTime now, CancellationToken cancellationToken)
    {
        using var scope = _services.CreateScope();
        var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
        var habit = await habits.GetHabitWithUserAsync(habitId, cancellationToken);
        if (habit?.SecondReminderUtc is not { } dueAt || dueAt > now || !_retries.CanAttempt(SecondHabitKind, habitId, dueAt, now)) return;

        var user = habit.User;
        var tz = TimezoneHelper.Find(user.Timezone) ?? TimeZoneInfo.Utc;
        var today = TimezoneHelper.LocalToday(user.Timezone, _time);
        var discordId = user.DiscordId();
        var targets = Targets(habit.ReminderChannels, user, discordId);
        var send = targets.Count > 0
            && user.SecondReminderMinutes > 0
            && habit.ReminderTime is not null
            && habit.Routine?.ReminderTime is null
            && now - dueAt <= StaleAfter
            && LocalDay(dueAt, tz) == today
            && !HabitService.IsPausedOn(habit, today)
            && HabitService.IsScheduledOn(habit, today)
            && !await habits.IsCompletedOnAsync(habit.Id, today, cancellationToken);

        var delivery = Delivery.NotDelivered;
        if (send)
        {
            var recent = await habits.CountCompletedBetweenAsync(habit.Id, today.AddDays(-7), today, cancellationToken);
            delivery = await DeliverAsync(targets, new Reminder(user.Id, discordId, habit.Id, habit.Name, recent, false, today, Second: true),
                user, now, (SecondHabitKind, habit.Id, dueAt), cancellationToken);
        }

        if (delivery != Delivery.Retry) habit.SecondReminderUtc = null;
        await habits.SaveChangesAsync(send ? CancellationToken.None : cancellationToken);
        if (delivery != Delivery.Retry) _retries.Forget(SecondHabitKind, habitId, dueAt);
    }

    /// <summary>
    /// Sends the routine's due second reminder, listing the members still pending or partial, under the same conditions as
    /// <see cref="ProcessSecondAsync"/>; then drops it either way.
    /// </summary>
    private async Task ProcessRoutineSecondAsync(int routineId, DateTime now, CancellationToken cancellationToken)
    {
        using var scope = _services.CreateScope();
        var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
        var routine = await habits.GetRoutineWithUserAsync(routineId, cancellationToken);
        if (routine?.SecondReminderUtc is not { } dueAt || dueAt > now || !_retries.CanAttempt(SecondRoutineKind, routineId, dueAt, now)) return;

        var user = routine.User;
        var tz = TimezoneHelper.Find(user.Timezone) ?? TimeZoneInfo.Utc;
        var today = TimezoneHelper.LocalToday(user.Timezone, _time);
        var discordId = user.DiscordId();
        var targets = Targets(routine.ReminderChannels, user, discordId);

        List<RoutineHabit> pending = [];
        if (targets.Count > 0 && user.SecondReminderMinutes > 0 && routine.ReminderTime is not null
            && now - dueAt <= StaleAfter && LocalDay(dueAt, tz) == today)
        {
            var lowDays = await habits.GetLowDaysAsync(user.Id);
            pending = HabitService.PendingRoutineHabits(routine.Habits, today, tz, lowDays)
                .Select(h => new RoutineHabit(h.Id, h.Name))
                .ToList();
        }

        var send = pending.Count > 0;
        var delivery = send
            ? await DeliverAsync(targets, new Reminder(user.Id, discordId, routine.Id, routine.Name, 0, false, today, pending, Second: true),
                user, now, (SecondRoutineKind, routine.Id, dueAt), cancellationToken)
            : Delivery.NotDelivered;

        if (delivery != Delivery.Retry) routine.SecondReminderUtc = null;
        await habits.SaveChangesAsync(send ? CancellationToken.None : cancellationToken);
        if (delivery != Delivery.Retry) _retries.Forget(SecondRoutineKind, routineId, dueAt);
    }

    /// <summary>
    /// When the user's second reminder is on: <see cref="User.SecondReminderMinutes"/> after <paramref name="sentAt"/>, or null when
    /// that falls on another local day than <paramref name="today"/>.
    /// </summary>
    private static DateTime? SecondReminderAt(User user, TimeZoneInfo tz, DateOnly today, DateTime sentAt)
        => user.SecondReminderMinutes > 0 && sentAt.AddMinutes(user.SecondReminderMinutes) is var at && LocalDay(at, tz) == today
            ? at
            : null;

    private static DateOnly LocalDay(DateTime utc, TimeZoneInfo tz)
        => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), tz));

    private async Task ClearSecondAsync(Func<HabitService, Task> clear)
    {
        try
        {
            using var scope = _services.CreateScope();
            await clear(scope.ServiceProvider.GetRequiredService<HabitService>());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Could not drop a second reminder.");
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

        habit.SecondReminderUtc = null;
        var delivery = Delivery.NotDelivered;
        if (send)
        {
            var weekAgo = today.AddDays(-7);
            var recent = await habits.CountCompletedBetweenAsync(habit.Id, weekAgo, today, cancellationToken);
            var snoozed = habit.ReminderTime is not { } time
                || TimezoneHelper.NextOccurrenceUtc(time, tz, dueAt.AddTicks(-1)) != dueAt;
            var reminder = new Reminder(user.Id, discordId, habit.Id, habit.Name, recent, snoozed, today);
            delivery = await DeliverAsync(targets, reminder, user, now, (HabitKind, habit.Id, dueAt), cancellationToken);
            if (delivery == Delivery.Delivered && !snoozed)
                habit.SecondReminderUtc = SecondReminderAt(user, tz, today, now);
        }

        if (delivery != Delivery.Retry)
            habit.NextReminderUtc = habit.ReminderTime is { } reminderTime
                ? TimezoneHelper.NextOccurrenceUtc(reminderTime, tz, now)
                : null;
        await habits.SaveChangesAsync(send ? CancellationToken.None : cancellationToken);
        if (delivery != Delivery.Retry) _retries.Forget(HabitKind, habitId, dueAt);
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
            pending = HabitService.PendingRoutineHabits(routine.Habits, today, tz, lowDays)
                .Select(h => new RoutineHabit(h.Id, h.Name))
                .ToList();
        }

        var send = pending.Count > 0;
        var delivery = send
            ? await DeliverAsync(targets, new Reminder(user.Id, discordId, routine.Id, routine.Name, 0, false, today, pending), user, now,
                (RoutineKind, routine.Id, dueAt), cancellationToken)
            : Delivery.NotDelivered;
        routine.SecondReminderUtc = delivery == Delivery.Delivered ? SecondReminderAt(user, tz, today, now) : null;

        if (delivery != Delivery.Retry)
            routine.NextReminderUtc = routine.ReminderTime is { } reminderTime
                ? TimezoneHelper.NextOccurrenceUtc(reminderTime, tz, now)
                : null;
        await habits.SaveChangesAsync(send ? CancellationToken.None : cancellationToken);
        if (delivery != Delivery.Retry) _retries.Forget(RoutineKind, routineId, dueAt);
    }

    /// <summary>The registered channels among <paramref name="channels"/> that the user can receive.</summary>
    private List<IReminderChannel> Targets(ReminderChannels channels, User user, ulong? discordId)
        => _channels.Where(c => channels.HasFlag(c.Channel) && c.Channel switch
        {
            ReminderChannels.Discord => discordId is not null && user.DmRemindersPausedAt is null,
            ReminderChannels.WebPush => user.PushSubscriptions.Count > 0,
            _ => false,
        }).ToList();

    /// <summary>
    /// Sends the reminder to each target. <see cref="Delivery.Retry"/> when no channel delivered it, a send failed transiently and
    /// <paramref name="key"/> has attempts left, so the caller keeps it due and changes nothing else. Otherwise the final Discord
    /// outcome updates the user's DM failure count and pause, once per due reminder: undeliverable, or transient failures until the
    /// last attempt, count as one failure.
    /// </summary>
    private async Task<Delivery> DeliverAsync(List<IReminderChannel> targets, Reminder reminder, User user, DateTime now,
        (string Kind, int Id, DateTime DueAt) key, CancellationToken cancellationToken)
    {
        var delivered = false;
        var transient = false;
        DeliveryOutcome? discord = null;
        var discordTransient = false;
        foreach (var channel in targets)
        {
            var (outcome, isTransient) = await SendAsync(channel, reminder, cancellationToken);
            delivered |= outcome == DeliveryOutcome.Delivered;
            transient |= isTransient;
            if (channel.Channel != ReminderChannels.Discord) continue;
            discord = outcome;
            discordTransient = isTransient;
        }

        if (delivered) _retries.Delivered(key.Kind, key.Id, key.DueAt, now);
        else if (transient && !_retries.Fail(key.Kind, key.Id, key.DueAt, now)) return Delivery.Retry;

        if (discord == DeliveryOutcome.Delivered)
        {
            user.DmFailureCount = 0;
        }
        else if ((discord is not null || discordTransient) && !reminder.Second && ++user.DmFailureCount >= MaxConsecutiveDmFailures)
        {
            user.DmRemindersPausedAt = now;
            _logger.LogWarning("Pausing DM reminders for user {UserId} after {Count} undeliverable reminders.",
                user.Id, user.DmFailureCount);
        }
        return delivered ? Delivery.Delivered : Delivery.NotDelivered;
    }

    /// <summary>A failure worth retrying soon: a timeout, a network error, or Discord answering 5xx or 429.</summary>
    internal static bool IsTransient(Exception ex) => ex switch
    {
        TimeoutException or TaskCanceledException or HttpRequestException or IOException or System.Net.Sockets.SocketException => true,
        Discord.Net.HttpException http => (int)http.HttpCode >= 500 || (int)http.HttpCode == 429,
        _ => false,
    };

    private async Task DeferAsync(int habitId, DateTime now, CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<HabitService>()
                .DeferReminderAsync(habitId, now, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Could not defer the reminder for habit {HabitId}.", habitId);
        }
    }

    private async Task DeferRoutineAsync(int routineId, DateTime now, CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<HabitService>()
                .DeferRoutineReminderAsync(routineId, now, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Could not defer the reminder for routine {RoutineId}.", routineId);
        }
    }

    /// <summary>The channel's outcome, or null and whether the failure <see cref="IsTransient"/> when the send threw.</summary>
    private async Task<(DeliveryOutcome? Outcome, bool Transient)> SendAsync(IReminderChannel channel, Reminder reminder,
        CancellationToken cancellationToken)
    {
        try
        {
            var outcome = await channel.SendAsync(reminder, cancellationToken);
            if (outcome != DeliveryOutcome.Delivered)
                _logger.LogWarning("{Channel} reminder for habit {HabitId} to user {UserId} was not delivered: {Outcome}.",
                    channel.Channel, reminder.HabitId, reminder.UserId, outcome);
            return (outcome, false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send {Channel} reminder for habit {HabitId} to user {UserId}.",
                channel.Channel, reminder.HabitId, reminder.UserId);
            return (null, IsTransient(ex));
        }
    }
}
