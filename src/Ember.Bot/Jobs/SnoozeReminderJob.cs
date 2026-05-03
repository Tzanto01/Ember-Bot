using Discord;
using Ember.Bot.Data;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Quartz;

namespace Ember.Bot.Jobs;

/// <summary>
/// One-shot job that re-sends a reminder DM after a snooze period.
/// Created dynamically — not registered at startup.
/// </summary>
[DisallowConcurrentExecution]
public class SnoozeReminderJob : IJob
{
    public const string HabitIdKey   = "habitId";
    public const string UserIdKey    = "userId";
    public const string HabitNameKey = "habitName";

    private readonly IServiceProvider _services;
    private readonly IDiscordDmSender _discord;
    private readonly ILogger<SnoozeReminderJob> _logger;

    public SnoozeReminderJob(IServiceProvider services, IDiscordDmSender discord, ILogger<SnoozeReminderJob> logger)
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

        // Skip if already checked in
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var alreadyDone = await db.HabitLogs
            .AnyAsync(l => l.HabitId == habitId && l.Date == today && l.Completed);

        if (alreadyDone) return;

        try
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var components = new ComponentBuilder()
                .WithButton("Done ✅", $"checkin:done:{habitId}:{now}", ButtonStyle.Success)
                .WithButton("Skip ❌", $"checkin:skip:{habitId}:{now}", ButtonStyle.Secondary)
                .WithButton("Snooze 1h ⏰", $"checkin:snooze:{habitId}:{now}", ButtonStyle.Secondary)
                .Build();

            await _discord.SendMessageAsync(
                userId,
                $"⏰ Snoozed reminder: **{habitName}**. Ready when you are!\n\nDid you follow this habit today?",
                components: components);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send snooze reminder DM to user {UserId}.", userId);
        }
    }
}
