using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using System.Text.Json;

namespace Ember.Tests;

public class ExportBuilderTests
{
    private static User SampleUser()
    {
        var user = new User
        {
            Id = TestUsers.Id(1), Logins = TestUsers.Discord(1),
            Timezone = "Europe/Berlin",
            GraceDaysPerWeek = 2,
            LeaderboardOptIn = true,
            DmFailureCount = 3,
            DmRemindersPausedAt = new DateTime(2025, 6, 17, 9, 0, 0, DateTimeKind.Utc),
            DmPauseNoticeSentAt = new DateTime(2025, 6, 18, 7, 45, 0, DateTimeKind.Utc),
            HealthDataConsentAt = new DateTime(2025, 6, 1, 12, 0, 0, DateTimeKind.Utc),
            ConsentPolicyVersion = "2026-10",
            ConsentPromptedOn = new DateOnly(2025, 6, 1),
        };

        var logged = HabitFactory.Make((1, true), (2, false));
        logged.Id = 10;
        logged.Name = "Read";
        logged.Logs.First().GuildId = 123456789012345678;

        var unlogged = HabitFactory.Make();
        unlogged.Id = 11;
        unlogged.Name = "Stretch";
        unlogged.ReminderTime = new TimeOnly(8, 30);
        unlogged.NextReminderUtc = new DateTime(2025, 6, 19, 6, 30, 0, DateTimeKind.Utc);
        unlogged.PausedFrom = new DateOnly(2025, 6, 17);
        unlogged.PausedUntil = new DateOnly(2025, 6, 20);

        user.Habits.Add(logged);
        user.Habits.Add(unlogged);
        user.DayMarks.Add(new DayMark { Date = new DateOnly(2025, 6, 16), Kind = DayMarkKind.LowDay });
        return user;
    }

    private static List<Dictionary<string, string>> Rows(string csv)
    {
        var lines = csv.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        var header = lines[0].Split(',');
        lines.Skip(1).Should().OnlyContain(l => l.Split(',').Length == header.Length);
        return lines.Skip(1)
            .Select(l => header.Zip(l.Split(',')).ToDictionary(p => p.First, p => p.Second))
            .ToList();
    }

    [Fact]
    public void Csv_IncludesSettingsHabitsWithoutLogsAndGuildIds()
    {
        var rows = Rows(ExportBuilder.BuildCsv(SampleUser()));

        rows.Should().ContainSingle(r => r["record_type"] == "settings"
            && r["timezone"] == "Europe/Berlin" && r["grace_days_per_week"] == "2" && r["leaderboard_opt_in"] == "true"
            && r["dm_failure_count"] == "3"
            && r["dm_reminders_paused_at"] == "2025-06-17T09:00:00Z"
            && r["dm_pause_notice_sent_at"] == "2025-06-18T07:45:00Z"
            && r["health_data_consent_at"] == "2025-06-01T12:00:00Z" && r["consent_policy_version"] == "2026-10"
            && r["consent_prompted_on"] == "2025-06-01");
        rows.Where(r => r["record_type"] == "habit").Select(r => r["habit_id"]).Should().BeEquivalentTo(["10", "11"]);
        rows.Should().ContainSingle(r => r["record_type"] == "habit" && r["habit_id"] == "11"
            && r["reminder_time"] == "08:30" && r["next_reminder_utc"] == "2025-06-19T06:30:00Z"
            && r["paused_from"] == "2025-06-17" && r["paused_until"] == "2025-06-20");
        rows.Where(r => r["record_type"] == "log").Should().HaveCount(2)
            .And.ContainSingle(r => r["guild_id"] == "123456789012345678");
        rows.Should().ContainSingle(r => r["record_type"] == "day_mark" && r["date"] == "2025-06-16" && r["kind"] == "low_day");
    }

    [Fact]
    public void Csv_NeutralizesFormulaInjectionInHabitNames()
    {
        var user = SampleUser();
        user.Habits.First().Name = "=HYPERLINK(\"x\")";
        user.Habits.Last().Name = "@SUM(1,2)";

        var csv = ExportBuilder.BuildCsv(user);

        csv.Should().Contain(",\"'=HYPERLINK(\"\"x\"\")\",");
        csv.Should().Contain(",\"'@SUM(1,2)\",");
        csv.Split("\r\n").Should().NotContain(line => line.Contains(",=") || line.Contains(",@") || line.Contains(",\"="));
    }

    [Fact]
    public void Csv_NeutralizesFormulasHiddenBehindLeadingWhitespace()
    {
        var user = SampleUser();
        user.Habits.First().Name = " =HYPERLINK(\"x\")";
        user.Habits.Last().Name = "\t\n+SUM(1)";

        var csv = ExportBuilder.BuildCsv(user);

        csv.Should().Contain(",\"' =HYPERLINK(\"\"x\"\")\",");
        csv.Should().Contain(",\"'\t\n+SUM(1)\",");
    }

    [Fact]
    public void Json_RoundTripsWithAllRecords()
    {
        var json = ExportBuilder.BuildJson(SampleUser());

        var doc = JsonSerializer.Deserialize<ExportBuilder.ExportDocument>(json,
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower });

        doc.Should().NotBeNull();
        doc!.Settings.Should().Be(new ExportBuilder.SettingsRecord("Europe/Berlin", 2, true, 3,
            new DateTime(2025, 6, 17, 9, 0, 0, DateTimeKind.Utc), new DateTime(2025, 6, 18, 7, 45, 0, DateTimeKind.Utc),
            new DateTime(2025, 6, 1, 12, 0, 0, DateTimeKind.Utc), "2026-10", new DateOnly(2025, 6, 1)));
        doc.Habits.Should().HaveCount(2).And.Contain(h => h.Id == 11 && h.ReminderTime == new TimeOnly(8, 30)
            && h.NextReminderUtc == new DateTime(2025, 6, 19, 6, 30, 0, DateTimeKind.Utc));
        doc.Logs.Should().HaveCount(2).And.Contain(l => l.HabitId == 10 && l.GuildId == "123456789012345678");
        doc.DayMarks.Should().Equal(new ExportBuilder.DayMarkRecord(new DateOnly(2025, 6, 16), "low_day"));
    }
}
