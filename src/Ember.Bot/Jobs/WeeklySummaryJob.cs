using Discord;
using Ember.Bot.Data;
using Ember.Bot.Models;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Quartz;

namespace Ember.Bot.Jobs;

/// <summary>
/// Fires once per week (Sunday at 09:00 UTC) for every user who has at least one habit.
/// Sends a DM recapping the 7-day window ending yesterday (the last complete day):
/// per-habit check-in counts, current streaks, and a tone-appropriate line.
///
/// Users with zero check-ins in the window still get a DM — a gentle nudge, not
/// silence: Ember's philosophy is soft re-engagement, and going quiet at exactly the
/// moment someone disengages is the failure mode to avoid. Users with nothing to
/// summarise (no habits, or every habit created today / paused all week) are skipped —
/// a 0/0 recap is noise, and paused users asked for quiet.
/// </summary>
[DisallowConcurrentExecution]
public class WeeklySummaryJob : IJob
{
    public static readonly JobKey Key = new("weekly-summary", "summaries");

    private readonly IServiceProvider _services;
    private readonly IDiscordDmSender _discord;
    private readonly ILogger<WeeklySummaryJob> _logger;

    public WeeklySummaryJob(IServiceProvider services, IDiscordDmSender discord, ILogger<WeeklySummaryJob> logger)
    {
        _services = services;
        _discord  = discord;
        _logger   = logger;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();

        // Get all users who have at least one habit
        var users = await db.Users
            .Include(u => u.Habits)
                .ThenInclude(h => h.Logs)
            .Where(u => u.Habits.Any())
            .ToListAsync(context.CancellationToken);

        var weekEnd = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1); // yesterday — last complete day

        _logger.LogInformation("WeeklySummaryJob: evaluating {Count} users.", users.Count);

        foreach (var user in users)
        {
            try
            {
                await SendSummaryAsync(user, weekEnd);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to send weekly summary to user {UserId}.", user.DiscordUserId);
            }
        }
    }

    private async Task SendSummaryAsync(User user, DateOnly weekEnd)
    {
        var summary = WeeklySummaryService.Build(user, weekEnd);
        if (!summary.HasSummarableWeek)
        {
            _logger.LogDebug("WeeklySummaryJob: nothing to summarise for user {UserId}, skipping.", user.DiscordUserId);
            return;
        }

        var (headline, footer) = WeeklySummaryService.ToneLines(summary.TotalDone, summary.TotalPossible);

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle("🗓️ Your weekly habit summary")
            .WithDescription(headline);

        // Discord caps embeds at EmbedBuilder.MaxFieldCount (25) fields; exceeding it
        // throws and the user would silently get no DM. Reserve the last slot for an
        // overflow line when a user has more habits than fit.
        var habits = summary.Habits;
        var overflow = habits.Count > EmbedBuilder.MaxFieldCount
            ? habits.Count - (EmbedBuilder.MaxFieldCount - 1)
            : 0;

        foreach (var h in habits.Take(overflow > 0 ? EmbedBuilder.MaxFieldCount - 1 : habits.Count))
            embed.AddField(h.Habit.Name, FormatHabitLine(h), inline: false);

        if (overflow > 0)
            embed.AddField("…and more", $"Plus **{overflow}** more habits — see them all with `/habit list`.", inline: false);

        embed.WithFooter(footer);
        await _discord.SendMessageAsync((ulong)user.DiscordUserId, embed: embed.Build());
    }

    private static string FormatHabitLine(WeeklySummaryService.HabitSummary h)
    {
        if (h.Habit.FrequencyType == FrequencyType.Weekly)
            return $"{h.DotString} **{h.Done}/{h.Possible}** · Weekly goal: **{h.Habit.WeeklyTarget ?? 3}**/wk";

        var graceStr = h.GraceUsed > 0 ? $" _(+{h.GraceUsed} flex)_" : "";
        return $"{h.DotString} **{h.Done}/{h.Possible}** · Streak: **{h.CurrentStreak}** days{graceStr}";
    }
}
