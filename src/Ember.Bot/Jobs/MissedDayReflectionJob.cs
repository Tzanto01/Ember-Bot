using Discord;
using Ember.Bot.Services;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Quartz;

namespace Ember.Bot.Jobs;

/// <summary>
/// Fires once per day at <see cref="LocalSendHour"/>:00 in each user's local time.
/// Checks whether any daily habits are still unlogged for yesterday, which is
/// still open (see <see cref="HabitService.OpenDays"/>), or weekly habits are
/// below target for the week, and sends a low-pressure invitation DM with
/// "Log yesterday", "It was a low day" and dismiss buttons.
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
        var habits = scope.ServiceProvider.GetRequiredService<HabitService>();

        var candidates = await habits.GetUserTimezonesWithHabitsAsync(context.CancellationToken);

        var dueIds = candidates
            .Where(u => TimezoneHelper.LocalNow(u.Timezone, _time).Hour == LocalSendHour)
            .Select(u => u.UserId)
            .ToList();

        if (dueIds.Count == 0) return;

        var users = await habits.GetUsersWithHabitsAsync(dueIds, context.CancellationToken);

        foreach (var user in users)
        {
            try
            {
                // Only Discord users get the reflection DM; a web-only user has nowhere to receive it yet.
                if (user.DiscordId() is not { } discordId
                    || !await habits.UserExistsAsync(user.Id, context.CancellationToken))
                    continue;

                var yesterday = TimezoneHelper.LocalToday(user.Timezone, _time).AddDays(-1);
                await ProcessUserAsync(user, discordId, yesterday, HabitService.WeekStart(yesterday));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "MissedDayReflectionJob failed for user {UserId}", user.Id);
            }
        }
    }

    private async Task ProcessUserAsync(Ember.Core.Models.User user, ulong discordId, DateOnly yesterday, DateOnly weekStart)
    {
        if (user.DayMarks.Any(m => m.Kind == Ember.Core.Models.DayMarkKind.LowDay && m.Date == yesterday)) return;

        var open = new List<string>();
        var anyDaily = false;
        var tz = TimezoneHelper.Find(user.Timezone) ?? TimeZoneInfo.Utc;

        foreach (var habit in user.Habits)
        {
            if (habit.FrequencyType == Ember.Core.Models.FrequencyType.Daily)
            {
                if (IsOpenDaily(habit, yesterday, tz))
                {
                    open.Add(habit.Name);
                    anyDaily = true;
                }
            }
            else if (HabitService.IsActiveOn(habit, yesterday, tz) && !HabitService.IsPausedOn(habit, yesterday))
            {
                // Weekly habit: are they behind target with 2 or fewer days left in the week?
                var weekEnd   = weekStart.AddDays(6);
                var daysLeft  = (weekEnd.DayNumber - yesterday.DayNumber); // days remaining after yesterday
                var doneCount = habit.Logs.Count(l => l.Completed && l.Date >= weekStart && l.Date <= yesterday);
                var target    = habit.WeeklyTarget ?? 3;
                var needed    = target - doneCount;

                // Only nudge if they need to catch up and have 1–2 days remaining
                if (needed > 0 && daysLeft is > 0 and <= 2)
                    open.Add($"{habit.Name} ({doneCount}/{target} this week)");
            }
        }

        if (open.Count == 0) return;

        var opening = open.Count == 1
            ? $"Yesterday is still open: want to log **{open[0]}**?"
            : "Yesterday is still open: want to log any of these?\n" + string.Join("\n", open.Select(m => $"• **{m}**"));

        var closingLines = new[]
        {
            "No pressure, and no reply needed.",
            "Life happens. You're still here, and that matters.",
            "A quiet day doesn't undo the work you've put in.",
            "There's no streak worth burning yourself out for.",
            "If it was a rough day, a low day keeps your streaks safe.",
        };
        var closing = closingLines[Math.Abs(discordId.GetHashCode()) % closingLines.Length];

        var embed = new EmbedBuilder()
            .WithColor(0x5865F2) // soft indigo — calm, not alarm
            .WithTitle("💙 A gentle check-in")
            .WithDescription($"{opening}\n\n{closing}")
            .WithFooter("Log it, mark a low day, or just move on.")
            .Build();

        var date = yesterday.ToString("yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture);
        var components = new ComponentBuilder();
        if (anyDaily)
            components.WithButton("Log yesterday", $"reflect:log:{discordId}:{date}", ButtonStyle.Success, new Emoji("✅"));
        components
            .WithButton("It was a low day", $"reflect:low:{discordId}:{date}", ButtonStyle.Secondary, new Emoji("🌙"))
            .WithButton("That's ok, move on", $"reflect:dismiss:{discordId}", ButtonStyle.Secondary);

        await _discord.SendMessageAsync(discordId, embed: embed, components: components.Build());
    }

    /// <summary>Whether a daily habit is active and unpaused on <paramref name="date"/> but not logged as done yet.</summary>
    internal static bool IsOpenDaily(Ember.Core.Models.Habit habit, DateOnly date, TimeZoneInfo tz)
        => habit.FrequencyType == Ember.Core.Models.FrequencyType.Daily
            && HabitService.IsActiveOn(habit, date, tz)
            && !HabitService.IsPausedOn(habit, date)
            && !habit.Logs.Any(l => l.Date == date && l.Completed);
}
