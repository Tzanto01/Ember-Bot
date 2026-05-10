using Discord;
using Ember.Bot.Data;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Quartz;

namespace Ember.Bot.Jobs;

/// <summary>
/// Fires once per week (Sunday at 09:00 UTC) for every user who has at least one habit.
/// Sends a DM summarising the past 7 days — how many habits were hit, encouragement, streaks.
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
            .ToListAsync();

        _logger.LogInformation("WeeklySummaryJob: sending summaries to {Count} users.", users.Count);

        foreach (var user in users)
        {
            try
            {
                await SendSummaryAsync((ulong)user.DiscordUserId, user.Habits.ToList());
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to send weekly summary to user {UserId}.", user.DiscordUserId);
            }
        }
    }

    private async Task SendSummaryAsync(ulong discordUserId, List<Models.Habit> habits)
    {
        var weekEnd = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1); // yesterday — last complete day
        var cutoff  = weekEnd.AddDays(-6);                                 // 7-day window ending yesterday

        // Tally up
        int totalHabits = habits.Count;
        int totalPossible = totalHabits * 7;
        int totalDone = habits.Sum(h => h.Logs.Count(l => l.Completed && l.Date >= cutoff && l.Date <= weekEnd));
        int perfectHabits = habits.Count(h => h.Logs.Count(l => l.Completed && l.Date >= cutoff && l.Date <= weekEnd) == 7);

        string headline;
        string footer;

        if (totalDone == 0)
        {
            headline = "It's been a quiet week — and that's okay. 💙\nWhenever you're ready, your habits are here waiting.";
            footer   = "No pressure. Progress happens at its own pace.";
        }
        else if (totalDone == totalPossible)
        {
            headline = $"You nailed every single check-in this week 🔥 That's {totalDone}/{totalPossible}. Incredible.";
            footer   = "You're on fire. Keep going.";
        }
        else
        {
            var pct = (int)Math.Round(100.0 * totalDone / totalPossible);
            headline = $"This week you completed **{totalDone}/{totalPossible}** check-ins ({pct}%). Every one of those counts. 💪";
            footer   = pct >= 50
                ? "More than half — that's a win. Keep it up."
                : "Small steps still move forward. You've got this.";
        }

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle("🗓️ Your weekly habit summary")
            .WithDescription(headline);

        foreach (var h in habits)
        {
            var doneThisWeek = h.Logs.Count(l => l.Completed && l.Date >= cutoff && l.Date <= weekEnd);
            var best = HabitService.BestStreak(h);
            var dots = BuildDotString(h, cutoff, weekEnd);
            embed.AddField(
                $"{h.Name}",
                $"{dots} **{doneThisWeek}/7** · Best streak: **{best}**",
                inline: false);
        }

        embed.WithFooter(footer);
        await _discord.SendMessageAsync(discordUserId, embed: embed.Build());
    }

    /// <summary>
    /// Builds a 7-character dot string like ✅⬜✅✅⬜✅✅ representing the last 7 days oldest→newest.
    /// </summary>
    private static string BuildDotString(Models.Habit habit, DateOnly from, DateOnly to)
    {
        var completedDates = habit.Logs
            .Where(l => l.Completed && l.Date >= from && l.Date <= to)
            .Select(l => l.Date)
            .ToHashSet();

        var parts = new List<string>();
        for (var d = from; d <= to; d = d.AddDays(1))
            parts.Add(completedDates.Contains(d) ? "✅" : "⬜");

        return string.Concat(parts);
    }
}
