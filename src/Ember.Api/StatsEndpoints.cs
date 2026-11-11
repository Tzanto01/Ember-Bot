using System.Security.Claims;
using System.Text.RegularExpressions;
using Ember.Core.Models;
using Ember.Core.Services;

namespace Ember.Api;

/// <summary>The weekly summary the bot sends as a DM, as plain data, and the per-day stats for the year view.</summary>
internal static partial class StatsEndpoints
{
    public sealed record WeeklyHabitDto(int HabitId, string Name, int Done, int Possible, int? Streak);
    public sealed record WeeklyDto(int TotalDone, int TotalPossible, string Headline, string Footer, List<WeeklyHabitDto> Habits);

    public static RouteGroupBuilder MapStats(this RouteGroupBuilder api)
    {
        api.MapGet("/stats/weekly", async (ClaimsPrincipal principal, HabitService habits, TimeProvider time) =>
        {
            var user = await habits.GetUserForExportAsync(principal.UserId());
            if (user is null) return Problems.NotFound();

            var summary = WeeklySummaryService.Build(user, TimezoneHelper.LocalToday(user.Timezone, time).AddDays(-1));
            var (headline, footer) = summary.HasSummarableWeek ? WeeklySummaryService.ToneLines(summary.TotalDone, summary.TotalPossible) : ("", "");
            return Results.Ok(new WeeklyDto(summary.TotalDone, summary.TotalPossible, PlainText(headline), PlainText(footer),
                summary.Habits.Select(h => new WeeklyHabitDto(h.Habit.Id, h.Habit.Name, h.Done, h.Possible,
                    h.Habit.FrequencyType != FrequencyType.Weekly ? (int?)h.CurrentStreak : null)).ToList()));
        });

        api.MapGet("/stats/days", async (string? from, string? to, ClaimsPrincipal principal, HabitService habits) =>
        {
            var userId = principal.UserId();
            var today = await habits.GetLocalTodayAsync(userId);
            var errors = new Dictionary<string, string[]>();
            var end = Formats.DateOr(to, today, "to", errors);
            var start = Formats.DateOr(from, Formats.DaysBefore(end, HabitEndpoints.MaxDaysPerRequest - 1), "from", errors);
            if (errors.Count == 0)
            {
                if (end > today) errors["to"] = ["Can't be after today."];
                else if (start > end) errors["from"] = ["Can't be after to."];
                else if (end.DayNumber - start.DayNumber + 1 > HabitEndpoints.MaxDaysPerRequest)
                    errors["from"] = [$"At most {HabitEndpoints.MaxDaysPerRequest} days per request."];
            }
            if (errors.Count > 0) return Problems.Validation(errors);

            return Results.Ok(await habits.GetDayStatsAsync(userId, start, end));
        });

        return api;
    }

    private static string PlainText(string discordMarkdown) => DiscordMarkdown().Replace(discordMarkdown, "");

    [GeneratedRegex(@"\*\*|__|~~|\|\||`")]
    private static partial Regex DiscordMarkdown();
}
