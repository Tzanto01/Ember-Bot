using Ember.Bot.Jobs;
using Ember.Bot.Models;
using Quartz;

namespace Ember.Bot.Services;

public class ReminderScheduler
{
    private readonly ISchedulerFactory _schedulerFactory;

    public ReminderScheduler(ISchedulerFactory schedulerFactory)
    {
        _schedulerFactory = schedulerFactory;
    }

    /// <summary>
    /// Schedules (or reschedules) a daily reminder for a habit.
    /// <paramref name="userTz"/> is the user's local timezone; the reminder time is
    /// stored in local time and converted to UTC for the cron trigger.
    /// </summary>
    public async Task ScheduleAsync(Habit habit, TimeZoneInfo? userTz = null)
    {
        if (!habit.ReminderTime.HasValue) return;

        var scheduler = await _schedulerFactory.GetScheduler();

        var tz      = userTz ?? TimeZoneInfo.Utc;
        var utcTime = TimezoneHelper.ToUtc(habit.ReminderTime.Value, tz);
        var jobKey  = JobKeyFor(habit.Id);

        var job = JobBuilder.Create<ReminderJob>()
            .WithIdentity(jobKey)
            .UsingJobData(ReminderJob.HabitIdKey,  habit.Id)
            .UsingJobData(ReminderJob.UserIdKey,    habit.UserId)
            .UsingJobData(ReminderJob.HabitNameKey, habit.Name)
            .Build();

        var trigger = TriggerBuilder.Create()
            .WithIdentity(TriggerKeyFor(habit.Id))
            .WithCronSchedule(BuildCron(utcTime))
            .Build();

        if (await scheduler.CheckExists(jobKey))
            await scheduler.DeleteJob(jobKey);

        await scheduler.ScheduleJob(job, trigger);
    }

    /// <summary>Schedules a one-shot snooze reminder for the given habit, firing after <paramref name="delayMinutes"/> minutes.</summary>
    public async Task SnoozeAsync(int habitId, long userId, string habitName, int delayMinutes = 60)
    {
        var scheduler = await _schedulerFactory.GetScheduler();
        var jobKey = new JobKey($"snooze-{habitId}-{userId}-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}", "snoozes");

        var job = JobBuilder.Create<SnoozeReminderJob>()
            .WithIdentity(jobKey)
            .UsingJobData(SnoozeReminderJob.HabitIdKey,   habitId)
            .UsingJobData(SnoozeReminderJob.UserIdKey,    userId)
            .UsingJobData(SnoozeReminderJob.HabitNameKey, habitName)
            .Build();

        var trigger = TriggerBuilder.Create()
            .WithIdentity($"snooze-trigger-{jobKey.Name}", "snoozes")
            .StartAt(DateTimeOffset.UtcNow.AddMinutes(delayMinutes))
            .Build();

        await scheduler.ScheduleJob(job, trigger);
    }

    /// <summary>Builds a daily cron expression for the given UTC time.</summary>
    internal static string BuildCron(TimeOnly utcTime) =>
        $"0 {utcTime.Minute} {utcTime.Hour} * * ?";

    public async Task UnscheduleAsync(int habitId)
    {
        var scheduler = await _schedulerFactory.GetScheduler();
        var jobKey = JobKeyFor(habitId);
        if (await scheduler.CheckExists(jobKey))
            await scheduler.DeleteJob(jobKey);
    }

    private static JobKey     JobKeyFor(int habitId)     => new($"habit-{habitId}", "reminders");
    private static TriggerKey TriggerKeyFor(int habitId) => new($"habit-{habitId}-trigger", "reminders");
}
