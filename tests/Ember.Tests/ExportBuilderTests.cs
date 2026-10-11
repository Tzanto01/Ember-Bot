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
        };

        var logged = HabitFactory.Make((1, true), (2, false));
        logged.Id = 10;
        logged.Name = "Read";
        logged.Logs.First().GuildId = 123456789012345678;

        var unlogged = HabitFactory.Make();
        unlogged.Id = 11;
        unlogged.Name = "Stretch";
        unlogged.ReminderTime = new TimeOnly(8, 30);

        user.Habits.Add(logged);
        user.Habits.Add(unlogged);
        return user;
    }

    private static List<string[]> Rows(string csv)
        => csv.Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Skip(1).Select(r => r.Split(',')).ToList();

    [Fact]
    public void Csv_IncludesSettingsHabitsWithoutLogsAndGuildIds()
    {
        var rows = Rows(ExportBuilder.BuildCsv(SampleUser()));

        rows.Should().ContainSingle(r => r[0] == "settings"
            && r[1] == "Europe/Berlin" && r[2] == "2" && r[3] == "true");
        rows.Where(r => r[0] == "habit").Select(r => r[4]).Should().BeEquivalentTo(["10", "11"]);
        rows.Should().ContainSingle(r => r[0] == "habit" && r[4] == "11" && r[8] == "08:30");
        rows.Where(r => r[0] == "log").Should().HaveCount(2)
            .And.ContainSingle(r => r[13] == "123456789012345678");
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
        doc!.Settings.Should().Be(new ExportBuilder.SettingsRecord("Europe/Berlin", 2, true));
        doc.Habits.Should().HaveCount(2).And.Contain(h => h.Id == 11 && h.ReminderTime == new TimeOnly(8, 30));
        doc.Logs.Should().HaveCount(2).And.Contain(l => l.HabitId == 10 && l.GuildId == "123456789012345678");
    }
}
