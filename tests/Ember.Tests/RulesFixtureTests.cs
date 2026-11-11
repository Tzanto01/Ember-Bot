using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Ember.Tests;

/// <summary>
/// Keeps docs/contracts/fixtures/rules-v1.json (the rules the no-account client reimplements) equal to what Core computes.
/// With <c>EMBER_WRITE_FIXTURES=1</c> it rewrites each case's <c>expected</c> from the case's inputs instead of asserting.
/// </summary>
public class RulesFixtureTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private sealed record LogInput(DateOnly Date, int Count, bool Completed);

    private sealed record HabitInput(int Id, string Frequency, int? WeeklyTarget, List<string>? Days, int TimesPerDay, DateOnly StartDate,
        DateOnly? PausedFrom, DateOnly? PausedUntil, int? RoutineId, List<LogInput> Logs);

    private sealed record RoutineInput(int Id, List<int> HabitIds);

    private sealed record CaseInput(string Name, DateOnly Today, DateOnly From, string Timezone, int GraceDaysPerWeek, List<DateOnly> LowDays,
        List<HabitInput> Habits, List<RoutineInput> Routines);

    private sealed record DayOut(DateOnly Date, string State, bool? Completed, int Count);

    private sealed record WeekOut(int Done, int Target);

    private sealed record StatsOut(int? Streak, int? GraceUsed, int? BestStreak, int Last7, WeekOut? Week);

    private sealed record DayStatsOut(DateOnly Date, int Scheduled, int Done, int Partial, bool ShowedUp);

    private sealed record ExpectedOut(Dictionary<string, List<DayOut>> Days, Dictionary<string, StatsOut> Stats, List<DayStatsOut> DayStats,
        Dictionary<string, List<int>> RoutinePending);

    [Fact]
    public void Core_matches_the_shared_rules_fixtures()
    {
        var path = Path.Combine(RepoRoot(), "docs", "contracts", "fixtures", "rules-v1.json");
        var root = JsonNode.Parse(File.ReadAllText(path))!;
        root["version"]!.GetValue<int>().Should().Be(1);
        var cases = root["cases"]!.AsArray();
        cases.Should().NotBeEmpty();
        var write = Environment.GetEnvironmentVariable("EMBER_WRITE_FIXTURES") == "1";

        var failures = new List<string>();
        foreach (var node in cases)
        {
            var input = node.Deserialize<CaseInput>(Json)!;
            var computed = JsonSerializer.SerializeToNode(Compute(input), Json)!;
            if (write)
                node!["expected"] = computed;
            else
                failures.AddRange(Differences(input.Name, node!["expected"], computed));
        }

        if (write)
            File.WriteAllText(path, root.ToJsonString(Json) + "\n");
        failures.Should().BeEmpty("rules-v1.json must match Core; after a deliberate rule change regenerate it with EMBER_WRITE_FIXTURES=1");
    }

    private static ExpectedOut Compute(CaseInput input)
    {
        var tz = TimezoneHelper.Find(input.Timezone) ?? throw new InvalidOperationException($"Unknown timezone {input.Timezone}.");
        var lowDays = input.LowDays.ToHashSet();
        var habits = input.Habits.Select(ToHabit).ToList();
        foreach (var routine in input.Routines)
            for (var i = 0; i < routine.HabitIds.Count; i++)
            {
                var member = habits.Single(h => h.Id == routine.HabitIds[i]);
                member.RoutineId.Should().Be(routine.Id, $"case \"{input.Name}\": habit {member.Id} is listed in routine {routine.Id}");
                member.RoutinePosition = i;
            }

        var dates = Enumerable.Range(0, input.Today.DayNumber - input.From.DayNumber + 1).Select(input.From.AddDays).ToList();
        return new ExpectedOut(
            habits.ToDictionary(h => Key(h.Id), h => dates.Select(d => HabitService.DayOn(h, d, input.Today, tz, lowDays))
                .Select(d => new DayOut(d.Date, d.State.ToString().ToLowerInvariant(), d.Completed, d.Count)).ToList()),
            habits.ToDictionary(h => Key(h.Id), h => ToStats(HabitService.StatsOn(h, input.Today, input.GraceDaysPerWeek, lowDays, tz))),
            dates.Select(d => HabitService.DayStatsOn(habits, d, tz))
                .Select(s => new DayStatsOut(s.Date, s.Scheduled, s.Done, s.Partial, s.ShowedUp)).ToList(),
            input.Routines.ToDictionary(r => Key(r.Id), r => HabitService.PendingRoutineHabits(
                habits.Where(h => h.RoutineId == r.Id), input.Today, tz, lowDays).Select(h => h.Id).ToList()));
    }

    private static Habit ToHabit(HabitInput input)
    {
        var frequency = Enum.Parse<FrequencyType>(input.Frequency, ignoreCase: true);
        ScheduleDays? days = null;
        if (input.Days is not null)
        {
            ScheduleDayNames.TryParse(input.Days, out var parsed).Should().BeTrue($"habit {input.Id} has valid days");
            days = parsed;
        }

        var habit = new Habit
        {
            Id = input.Id,
            Name = $"Habit {input.Id}",
            FrequencyType = frequency,
            WeeklyTarget = input.WeeklyTarget,
            Days = days,
            TimesPerDay = input.TimesPerDay,
            CreatedAt = input.StartDate.ToDateTime(new TimeOnly(12, 0), DateTimeKind.Utc),
            PausedFrom = input.PausedFrom,
            PausedUntil = input.PausedUntil,
            RoutineId = input.RoutineId,
        };
        foreach (var log in input.Logs)
            habit.Logs.Add(new HabitLog { Date = log.Date, Count = log.Count, Completed = log.Completed });
        return habit;
    }

    private static StatsOut ToStats(HabitStats s)
        => new(s.Streak, s.GraceUsed, s.BestStreak, s.Last7, s.Week is { } w ? new WeekOut(w.Done, w.Target) : null);

    private static string Key(int id) => id.ToString(System.Globalization.CultureInfo.InvariantCulture);

    private static IEnumerable<string> Differences(string name, JsonNode? expected, JsonNode computed)
    {
        if (expected is not JsonObject expectedObject)
        {
            yield return $"case \"{name}\": expected is missing";
            yield break;
        }

        foreach (var (section, value) in computed.AsObject())
        {
            var want = expectedObject[section];
            if (value is JsonObject byId)
            {
                if (want is not JsonObject wantById || !wantById.Select(p => p.Key).Order().SequenceEqual(byId.Select(p => p.Key).Order()))
                {
                    yield return $"case \"{name}\": {section} expected {want?.ToJsonString()} but Core computed {value.ToJsonString()}";
                    continue;
                }
                foreach (var (id, got) in byId)
                    if (FirstDifference(wantById[id], got) is { } diff)
                        yield return $"case \"{name}\": {section}[{id}] {diff}";
            }
            else if (FirstDifference(want, value) is { } diff)
            {
                yield return $"case \"{name}\": {section} {diff}";
            }
        }
    }

    private static string? FirstDifference(JsonNode? want, JsonNode? got)
    {
        if (JsonNode.DeepEquals(want, got)) return null;
        if (want is JsonArray wantArray && got is JsonArray gotArray && wantArray.Count == gotArray.Count)
            for (var i = 0; i < wantArray.Count; i++)
                if (!JsonNode.DeepEquals(wantArray[i], gotArray[i]))
                    return $"expected {wantArray[i]?.ToJsonString()} but Core computed {gotArray[i]?.ToJsonString()}";
        return $"expected {want?.ToJsonString()} but Core computed {got?.ToJsonString()}";
    }

    private static string RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "Ember.slnx"))) return dir.FullName;
        throw new InvalidOperationException("Ember.slnx not found above the test output directory.");
    }
}
