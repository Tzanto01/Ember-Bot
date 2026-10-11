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
/// Runs hourly and sends to every user with at least one habit whose local time is
/// Sunday at <see cref="LocalSendHour"/>:00.
/// Sends a DM recapping the 7-day window ending the user's local yesterday (the last complete day):
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
    private readonly TimeProvider _time;

    /// <summary>Local hour on Sunday at which each user receives their summary.</summary>
    public const int LocalSendHour = 9;

    public WeeklySummaryJob(IServiceProvider services, IDiscordDmSender discord, ILogger<WeeklySummaryJob> logger, TimeProvider time)
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
            .Where(u => TimezoneHelper.LocalNow(u.Timezone, _time) is { DayOfWeek: DayOfWeek.Sunday, Hour: LocalSendHour })
            .Select(u => u.DiscordUserId)
            .ToList();

        if (dueIds.Count == 0) return;

        var users = await db.Users
            .Include(u => u.Habits)
                .ThenInclude(h => h.Logs)
            .Where(u => dueIds.Contains(u.DiscordUserId))
            .ToListAsync(context.CancellationToken);

        _logger.LogInformation("WeeklySummaryJob: evaluating {Count} users.", users.Count);

        foreach (var user in users)
        {
            try
            {
                var weekEnd = TimezoneHelper.LocalToday(user.Timezone, _time).AddDays(-1);
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
