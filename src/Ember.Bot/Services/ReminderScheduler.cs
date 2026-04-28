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

    public async Task ScheduleAsync(Habit habit)
    {
        if (!habit.ReminderTime.HasValue) return;

        var key     = TriggerKeyFor(habit.Id);
        var jobKey  = JobKeyFor(habit.Id);
        var time    = habit.ReminderTime.Value;

        var job = JobBuilder.Create<ReminderJob>()
            .WithIdentity(jobKey)
            .UsingJobData(ReminderJob.HabitIdKey,   habit.Id)
            .UsingJobData(ReminderJob.UserIdKey,     habit.UserId)
            .UsingJobData(ReminderJob.HabitNameKey,  habit.Name)
            .Build();

        var trigger = TriggerBuilder.Create()
            .WithIdentity(key)
            .WithCronSchedule($"0 {time.Minute} {time.Hour} * * ?")
            .Build();

        if (await _scheduler.CheckExists(jobKey))
            await _scheduler.DeleteJob(jobKey);

        await _scheduler.ScheduleJob(job, trigger);
    }

    public async Task UnscheduleAsync(int habitId)
    {
        var jobKey = JobKeyFor(habitId);
        if (await _scheduler.CheckExists(jobKey))
            await _scheduler.DeleteJob(jobKey);
    }

    private static JobKey     JobKeyFor(int habitId)     => new($"habit-{habitId}", "reminders");
    private static TriggerKey TriggerKeyFor(int habitId) => new($"habit-{habitId}-trigger", "reminders");
}
