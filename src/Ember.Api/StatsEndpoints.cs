using System.Security.Claims;
using System.Text.RegularExpressions;
using Ember.Core.Models;
using Ember.Core.Services;

namespace Ember.Api;

/// <summary>The weekly summary the bot sends as a DM, as plain data.</summary>
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
            var (headline, footer) = WeeklySummaryService.ToneLines(summary.TotalDone, summary.TotalPossible);
            return Results.Ok(new WeeklyDto(summary.TotalDone, summary.TotalPossible, PlainText(headline), PlainText(footer),
                summary.Habits.Select(h => new WeeklyHabitDto(h.Habit.Id, h.Habit.Name, h.Done, h.Possible,
                    h.Habit.FrequencyType == FrequencyType.Daily ? (int?)h.CurrentStreak : null)).ToList()));
        });

        return api;
    }

    private static string PlainText(string discordMarkdown) => DiscordMarkdown().Replace(discordMarkdown, "");

    [GeneratedRegex(@"\*\*|__|~~|\|\||`")]
    private static partial Regex DiscordMarkdown();
}
