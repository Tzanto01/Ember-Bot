using Ember.Bot.Jobs;
using Ember.Bot.Models;
using Quartz;

namespace Ember.Bot.Services;

public class ReminderScheduler
{
    private readonly IScheduler _scheduler;

    public ReminderScheduler(IScheduler scheduler)
    {
        _scheduler = scheduler;
    }

    /// <summary>
    /// Schedules (or reschedules) a daily reminder for a habit.
    /// <paramref name="userTz"/> is the user's local timezone; the reminder time is
    /// stored in local time and converted to UTC for the cron trigger.
    /// </summary>
    public async Task ScheduleAsync(Habit habit, TimeZoneInfo? userTz = null)
    {
        if (!habit.ReminderTime.HasValue) return;

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

        if (await _scheduler.CheckExists(jobKey))
            await _scheduler.DeleteJob(jobKey);

        await _scheduler.ScheduleJob(job, trigger);
    }

    /// <summary>Builds a daily cron expression for the given UTC time.</summary>
    internal static string BuildCron(TimeOnly utcTime) =>
        $"0 {utcTime.Minute} {utcTime.Hour} * * ?";

    public async Task UnscheduleAsync(int habitId)
    {
        var jobKey = JobKeyFor(habitId);
        if (await _scheduler.CheckExists(jobKey))
            await _scheduler.DeleteJob(jobKey);
    }

    private static JobKey     JobKeyFor(int habitId)     => new($"habit-{habitId}", "reminders");
    private static TriggerKey TriggerKeyFor(int habitId) => new($"habit-{habitId}-trigger", "reminders");
}
