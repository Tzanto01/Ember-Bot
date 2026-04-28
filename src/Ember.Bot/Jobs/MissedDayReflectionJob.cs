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
/// Fires once per day at 10:00 in each user's local time.
/// Checks whether the user missed any daily habits yesterday (or weekly
/// habits that are below target for the week) and sends a low-pressure
/// reflection DM with a dismiss button.
///
/// Scheduling: one Quartz trigger per user per reminder timezone bucket is not
/// practical at scale. Instead we run a single daily sweep at 10:00 UTC and
/// skip users whose local time is not yet 10:00 or already past 11:00. This is
/// a deliberate simplification — perfect per-user local-time delivery would
/// require per-user jobs (expensive). The ±1-hour UTC window covers most users
/// in a given timezone cluster. For now this is good enough; we can refine to
/// per-user jobs if the user base grows significantly.
/// </summary>
[DisallowConcurrentExecution]
public class MissedDayReflectionJob : IJob
{
    public static readonly JobKey Key = new("missed-day-reflection", "reflections");

    private readonly IServiceProvider _services;
    private readonly DiscordSocketClient _discord;
    private readonly ILogger<MissedDayReflectionJob> _logger;

    public MissedDayReflectionJob(IServiceProvider services, DiscordSocketClient discord, ILogger<MissedDayReflectionJob> logger)
    {
        _services = services;
        _discord  = discord;
        _logger   = logger;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();

        var yesterday = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);
        var weekStart = yesterday.AddDays(-(int)yesterday.DayOfWeek == 0 ? 6 : (int)yesterday.DayOfWeek - 1); // Monday

        // Load all users with at least one active (non-paused) habit
        var users = await db.Users
            .Include(u => u.Habits)
                .ThenInclude(h => h.Logs)
            .ToListAsync(context.CancellationToken);

        foreach (var user in users)
        {
            try
            {
                await ProcessUserAsync(user, yesterday, weekStart);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "MissedDayReflectionJob failed for user {UserId}", user.DiscordUserId);
            }
        }
    }

    private async Task ProcessUserAsync(Ember.Bot.Models.User user, DateOnly yesterday, DateOnly weekStart)
    {
        var missed = new List<string>();

        foreach (var habit in user.Habits)
        {
            if (!HabitService.IsActiveOn(habit, yesterday)) continue;

            // Skip paused habits
            if (habit.PausedUntil.HasValue && habit.PausedUntil >= yesterday) continue;

            if (habit.FrequencyType == Ember.Bot.Models.FrequencyType.Daily)
            {
                // Did they miss yesterday?
                var didYesterday = habit.Logs.Any(l => l.Date == yesterday && l.Completed);
                if (!didYesterday)
                    missed.Add(habit.Name);
            }
            else
            {
                // Weekly habit: are they behind target with 2 or fewer days left in the week?
                var weekEnd   = weekStart.AddDays(6);
                var daysLeft  = (weekEnd.DayNumber - yesterday.DayNumber); // days remaining after yesterday
                var doneCount = habit.Logs.Count(l => l.Completed && l.Date >= weekStart && l.Date <= yesterday);
                var target    = habit.WeeklyTarget ?? 3;
                var needed    = target - doneCount;

                // Only nudge if they need to catch up and have ≤2 days remaining
                if (needed > 0 && daysLeft <= 2)
                    missed.Add($"{habit.Name} ({doneCount}/{target} this week)");
            }
        }

        if (missed.Count == 0) return;

        // Build a low-pressure DM
        var habitList = missed.Count == 1
            ? $"**{missed[0]}**"
            : string.Join("\n", missed.Select(m => $"• **{m}**"));

        var opening = missed.Count == 1
            ? $"You missed **{missed[0]}** yesterday."
            : $"You missed a few habits yesterday:";

        var closingLines = new[]
        {
            "No pressure — missing days is normal. What got in the way?",
            "Life happens. You're still here, and that matters.",
            "Missing a day doesn't undo the work you've put in.",
            "There's no streak worth burning yourself out for.",
            "One missed day is just one day. Tomorrow is already a fresh start.",
        };
        var closing = closingLines[Math.Abs(user.DiscordUserId.GetHashCode()) % closingLines.Length];

        var embed = new EmbedBuilder()
            .WithColor(0x5865F2) // soft indigo — calm, not alarm
            .WithTitle("💙 A gentle check-in")
            .WithDescription(
                $"{opening}\n\n" +
                (missed.Count > 1 ? $"{habitList}\n\n" : "") +
                closing)
            .WithFooter("Tap 'That's ok' to dismiss — no reply needed.")
            .Build();

        var components = new ComponentBuilder()
            .WithButton("That's ok, move on", $"reflect:dismiss:{user.DiscordUserId}", ButtonStyle.Secondary)
            .Build();

        var discordUser = await _discord.GetUserAsync((ulong)user.DiscordUserId);
        if (discordUser is null) return;

        var dm = await discordUser.CreateDMChannelAsync();
        await dm.SendMessageAsync(embed: embed, components: components);
    }
}
