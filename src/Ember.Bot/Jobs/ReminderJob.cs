using Discord;
using Ember.Bot.Data;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Quartz;

namespace Ember.Bot.Jobs;

/// <summary>
/// Fired once per habit at its configured ReminderTime.
/// Sends the user a DM with ✅/❌ buttons.
/// </summary>
[DisallowConcurrentExecution]
public class ReminderJob : IJob
{
    public static readonly JobKey Key = new("reminder");

    // Data map keys
    public const string HabitIdKey = "habitId";
    public const string UserIdKey  = "userId";
    public const string HabitNameKey = "habitName";

    private readonly IServiceProvider _services;
    private readonly IDiscordDmSender _discord;
    private readonly ILogger<ReminderJob> _logger;

    public ReminderJob(IServiceProvider services, IDiscordDmSender discord, ILogger<ReminderJob> logger)
    {
        _services = services;
        _discord  = discord;
        _logger   = logger;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        var data      = context.JobDetail.JobDataMap;
        var habitId   = data.GetInt(HabitIdKey);
        var userId    = (ulong)data.GetLong(UserIdKey);
        var habitName = data.GetString(HabitNameKey) ?? "your habit";

        _logger.LogInformation("ReminderJob firing for habit {HabitId} ({HabitName}), user {UserId}, scheduled fire time {FireTimeUtc}",
            habitId, habitName, userId, context.ScheduledFireTimeUtc);

        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        // Count how many of the last 7 days (excluding today) had a completed check-in
        var weekAgo = today.AddDays(-7);
        var recentCount = await db.HabitLogs
            .CountAsync(l => l.HabitId == habitId && l.Date > weekAgo && l.Date < today && l.Completed);

        string intro = recentCount >= 4
            ? $"Hey! Just a gentle nudge for **{habitName}**. You've been doing great 🔥"
            : recentCount >= 1
                ? $"Hey! Reminder for **{habitName}**. No pressure — just showing up counts 💙"
                : $"Hey 👋 Checking in on **{habitName}**. It's been a little while, and that's okay — today's a fresh start whenever you're ready.";

        var message = $"{intro}\n\nDid you follow this habit today?";

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var components = new ComponentBuilder()
            .WithButton("Done ✅", $"checkin:done:{habitId}:{now}", ButtonStyle.Success)
            .WithButton("Skip ❌", $"checkin:skip:{habitId}:{now}", ButtonStyle.Secondary)
            .WithButton("Snooze 1h ⏰", $"checkin:snooze:{habitId}:{now}", ButtonStyle.Secondary)
            .Build();

        try
        {
            var sent = await _discord.SendMessageAsync(userId, message, components: components);
            if (!sent)
            {
                _logger.LogWarning("Could not find Discord user {UserId} for reminder.", userId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send reminder DM to user {UserId}.", userId);
        }
    }
}
