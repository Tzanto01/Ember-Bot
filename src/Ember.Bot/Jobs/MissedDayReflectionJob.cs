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
/// below target for the week and weren't done yesterday, and sends a low-pressure DM with
/// "Log yesterday" (only when a daily habit is open), "It was a low day" and dismiss buttons.
///
/// Scheduling: a sweep every 15 minutes picks the users whose local time is in the first
/// quarter hour of <see cref="LocalSendHour"/>, so half- and quarter-hour timezones get it at :00 too;
/// yesterday and the week start are computed in each user's own timezone.
/// </summary>
[DisallowConcurrentExecution]
public class MissedDayReflectionJob : IJob
{
    public static readonly JobKey Key = new("missed-day-reflection", "reflections");

    /// <summary>Local hour at which each user receives the reflection.</summary>
    public const int LocalSendHour = 10;

    /// <summary>How many <c>missedday.closing.N</c> lines the reflection rotates through, one per day.</summary>
    private const int ClosingLineCount = 5;

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
            .Where(u => TimezoneHelper.LocalNow(u.Timezone, _time) is { Hour: LocalSendHour, Minute: < 15 })
            .Select(u => u.UserId)
            .ToList();

        if (dueIds.Count == 0) return;

        var users = await habits.GetUsersWithHabitsAsync(dueIds, context.CancellationToken,
            logsSince: DateOnly.FromDateTime(_time.GetUtcNow().UtcDateTime).AddDays(-8));

        foreach (var user in users)
        {
            try
            {
                // Only Discord users get the reflection DM; a web-only user has nowhere to receive it yet.
                if (user.DiscordId() is not { } discordId
                    || user.DmRemindersPausedAt is not null
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
        var weekly = new List<(string Name, string Progress)>();
        var tz = TimezoneHelper.Find(user.Timezone) ?? TimeZoneInfo.Utc;

        foreach (var habit in user.Habits)
        {
            if (habit.FrequencyType != Ember.Core.Models.FrequencyType.Weekly)
            {
                if (IsOpenDaily(habit, yesterday, tz))
                    open.Add(habit.Name);
            }
            else if (HabitService.IsActiveOn(habit, yesterday, tz) && !HabitService.IsPausedOn(habit, yesterday))
            {
                // Weekly habit: are they behind target with 2 or fewer days left in the week?
                var weekEnd   = weekStart.AddDays(6);
                var daysLeft  = (weekEnd.DayNumber - yesterday.DayNumber); // days remaining after yesterday
                var doneCount = habit.Logs.Count(l => l.Completed && l.Date >= weekStart && l.Date <= yesterday);
                var target    = habit.WeeklyTarget ?? 3;
                var needed    = target - doneCount;

                // Only nudge if they need to catch up, have 1–2 days remaining and didn't just do it yesterday
                if (needed > 0 && daysLeft is > 0 and <= 2 && !habit.Logs.Any(l => l.Date == yesterday && l.Completed))
                    weekly.Add((habit.Name, $"{doneCount}/{target}"));
            }
        }

        if (open.Count == 0 && weekly.Count == 0) return;

        var t = BotTexts.For(user.Language);
        var parts = new List<string>();
        if (open.Count == 1)
            parts.Add(t.Format("missedday.open.one", open[0]));
        else if (open.Count > 1)
            parts.Add(t.Format("missedday.open.many", string.Join("\n", open.Select(m => $"• **{m}**"))));
        if (weekly.Count == 1)
            parts.Add(t.Format("missedday.weekly.one", weekly[0].Progress, weekly[0].Name));
        else if (weekly.Count > 1)
            parts.Add(t.Format("missedday.weekly.many", string.Join("\n", weekly.Select(w => t.Format("missedday.weekly.line", w.Name, w.Progress)))));
        var opening = string.Join("\n\n", parts);

        var closing = t.Get($"missedday.closing.{yesterday.DayNumber % ClosingLineCount}");

        var embed = new EmbedBuilder()
            .WithColor(0x5865F2) // soft indigo — calm, not alarm
            .WithTitle(t.Get("missedday.title"))
            .WithDescription($"{opening}\n\n{closing}")
            .WithFooter(t.Get(open.Count > 0 ? "missedday.footer.open" : "missedday.footer"))
            .Build();

        var date = yesterday.ToString("yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture);
        var components = new ComponentBuilder();
        if (open.Count > 0)
            components.WithButton(t.Get("missedday.log"), $"reflect:log:{discordId}:{date}", ButtonStyle.Success, new Emoji("✅"));
        components
            .WithButton(t.Get("missedday.low"), $"reflect:low:{discordId}:{date}", ButtonStyle.Secondary, new Emoji("🌙"))
            .WithButton(t.Get("missedday.dismiss"), $"reflect:dismiss:{discordId}", ButtonStyle.Secondary);

        await _discord.SendMessageAsync(discordId, embed: embed, components: components.Build());
    }

    /// <summary>
    /// Whether a daily or weekdays habit is active, scheduled and unpaused on <paramref name="date"/> but not logged as done yet
    /// (a partial day is still open).
    /// </summary>
    internal static bool IsOpenDaily(Ember.Core.Models.Habit habit, DateOnly date, TimeZoneInfo tz)
        => habit.FrequencyType != Ember.Core.Models.FrequencyType.Weekly
            && HabitService.IsScheduledOn(habit, date)
            && HabitService.IsActiveOn(habit, date, tz)
            && !HabitService.IsPausedOn(habit, date)
            && !habit.Logs.Any(l => l.Date == date && l.Completed);
}
