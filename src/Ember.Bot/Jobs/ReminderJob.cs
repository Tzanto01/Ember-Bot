using Discord;
using Discord.WebSocket;
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
    private readonly DiscordSocketClient _discord;
    private readonly ILogger<ReminderJob> _logger;

    public ReminderJob(IServiceProvider services, DiscordSocketClient discord, ILogger<ReminderJob> logger)
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

        // Skip if already checked in today
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var alreadyDone = await db.HabitLogs
            .AnyAsync(l => l.HabitId == habitId && l.Date == today && l.Completed);

        if (alreadyDone)
        {
            _logger.LogDebug("Skipping reminder for habit {HabitId} — already checked in today.", habitId);
            return;
        }

        try
        {
            var user = await _discord.GetUserAsync(userId);
            if (user is null)
            {
                _logger.LogWarning("Could not find Discord user {UserId} for reminder.", userId);
                return;
            }

            var dm = await user.CreateDMChannelAsync();

            var components = new ComponentBuilder()
                .WithButton("Done ✅", $"checkin:done:{habitId}", ButtonStyle.Success)
                .WithButton("Skip ❌", $"checkin:skip:{habitId}", ButtonStyle.Secondary)
                .Build();

            await dm.SendMessageAsync(
                $"Hey! Just a gentle nudge — time for **{habitName}**. How's it going?",
                components: components);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send reminder DM to user {UserId}.", userId);
        }
    }
}
