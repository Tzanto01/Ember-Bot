using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;
using System.Text.Json;

namespace Ember.Tests;

public class ExportBuilderTests
{
    private static User SampleUser()
    {
        var user = new User
        {
            DiscordUserId = 1,
            Timezone = "Europe/Berlin",
            GraceDaysPerWeek = 2,
            LeaderboardOptIn = true,
            DmFailureCount = 3,
            DmRemindersPausedAt = new DateTime(2025, 6, 17, 9, 0, 0, DateTimeKind.Utc),
            DmPauseNoticeSentAt = new DateTime(2025, 6, 18, 7, 45, 0, DateTimeKind.Utc),
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

        user.Habits.Add(logged);
        user.Habits.Add(unlogged);
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
            && r["dm_pause_notice_sent_at"] == "2025-06-18T07:45:00Z");
        rows.Where(r => r["record_type"] == "habit").Select(r => r["habit_id"]).Should().BeEquivalentTo(["10", "11"]);
        rows.Should().ContainSingle(r => r["record_type"] == "habit" && r["habit_id"] == "11"
            && r["reminder_time"] == "08:30" && r["next_reminder_utc"] == "2025-06-19T06:30:00Z");
        rows.Where(r => r["record_type"] == "log").Should().HaveCount(2)
            .And.ContainSingle(r => r["guild_id"] == "123456789012345678");
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
    public void Json_RoundTripsWithAllRecords()
    {
        var json = ExportBuilder.BuildJson(SampleUser());

        var doc = JsonSerializer.Deserialize<ExportBuilder.ExportDocument>(json,
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower });

        doc.Should().NotBeNull();
        doc!.Settings.Should().Be(new ExportBuilder.SettingsRecord("Europe/Berlin", 2, true, 3,
            new DateTime(2025, 6, 17, 9, 0, 0, DateTimeKind.Utc), new DateTime(2025, 6, 18, 7, 45, 0, DateTimeKind.Utc)));
        doc.Habits.Should().HaveCount(2).And.Contain(h => h.Id == 11 && h.ReminderTime == new TimeOnly(8, 30)
            && h.NextReminderUtc == new DateTime(2025, 6, 19, 6, 30, 0, DateTimeKind.Utc));
        doc.Logs.Should().HaveCount(2).And.Contain(l => l.HabitId == 10 && l.GuildId == "123456789012345678");
    }
}
