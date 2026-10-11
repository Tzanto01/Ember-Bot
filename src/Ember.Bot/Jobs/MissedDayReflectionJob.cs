using Discord;
using Ember.Bot.Data;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Quartz;

namespace Ember.Bot.Jobs;

/// <summary>
/// Fires once per day at <see cref="LocalSendHour"/>:00 in each user's local time.
/// Checks whether the user missed any daily habits yesterday (or weekly
/// habits that are below target for the week) and sends a low-pressure
/// reflection DM with a dismiss button.
///
/// Scheduling: a single hourly sweep picks the users whose local hour is
/// <see cref="LocalSendHour"/>; yesterday and the week start are computed in
/// each user's own timezone.
/// </summary>
[DisallowConcurrentExecution]
public class MissedDayReflectionJob : IJob
{
    public static readonly JobKey Key = new("missed-day-reflection", "reflections");

    /// <summary>Local hour at which each user receives the reflection.</summary>
    public const int LocalSendHour = 10;

    private readonly IServiceProvider _services;
    private readonly IDiscordDmSender _discord;
    private readonly ILogger<MissedDayReflectionJob> _logger;
    private readonly TimeProvider _time;

    public MissedDayReflectionJob(IServiceProvider services, IDiscordDmSender discord, ILogger<MissedDayReflectionJob> logger, TimeProvider time)
    {
        _services = services;
        _discord  = discord;
        _logger   = logger;
        _time     = time;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();

        var candidates = await db.Users
            .Where(u => u.Habits.Any())
            .Select(u => new { u.DiscordUserId, u.Timezone })
            .ToListAsync(context.CancellationToken);

        var dueIds = candidates
            .Where(u => TimezoneHelper.LocalNow(u.Timezone, _time).Hour == LocalSendHour)
            .Select(u => u.DiscordUserId)
            .ToList();

        if (dueIds.Count == 0) return;

        var users = await db.Users
            .Include(u => u.Habits)
                .ThenInclude(h => h.Logs)
            .Where(u => dueIds.Contains(u.DiscordUserId))
            .ToListAsync(context.CancellationToken);

        foreach (var user in users)
        {
            try
            {
                if (!await db.Users.AnyAsync(u => u.DiscordUserId == user.DiscordUserId, context.CancellationToken))
                    continue;

                var yesterday = TimezoneHelper.LocalToday(user.Timezone, _time).AddDays(-1);
                await ProcessUserAsync(user, yesterday, HabitService.WeekStart(yesterday));
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
        var tz = TimezoneHelper.Find(user.Timezone) ?? TimeZoneInfo.Utc;

        foreach (var habit in user.Habits)
        {
            if (!HabitService.IsActiveOn(habit, yesterday, tz)) continue;

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

                // Only nudge if they need to catch up and have 1–2 days remaining
                if (needed > 0 && daysLeft is > 0 and <= 2)
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

        await _discord.SendMessageAsync((ulong)user.DiscordUserId, embed: embed, components: components);
    }
}
