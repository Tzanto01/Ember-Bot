using Ember.Bot.Models;

namespace Ember.Tests;

internal static class HabitFactory
{
    public static Habit Make(params (int daysAgo, bool completed)[] entries)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var habit = new Habit { Id = 1, Name = "Test" };
        foreach (var (daysAgo, completed) in entries)
            habit.Logs.Add(new HabitLog { Date = today.AddDays(-daysAgo), Completed = completed });
        return habit;
    }
}
