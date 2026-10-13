using Ember.Bot.Modules;
using FluentAssertions;

namespace Ember.Tests;

public class ShareCardTests
{
    [Fact]
    public void ShareCard_ShowsGapsAndLowDaysTheSameNeutralWay_SoLowDaysStayPrivate()
    {
        var habit = HabitFactory.Make((2, true), (4, false));
        var lowDays = new HashSet<DateOnly> { HabitFactory.Today.AddDays(-3), HabitFactory.Today };

        var description = HabitSelectModule.BuildShareEmbed(habit, 1, "nico", HabitFactory.Today, lowDays).Description;
        var grid = description.Split("\n\n")[1];

        grid.Should().NotContain("🟥").And.NotContain("🌙");
        grid.Replace("\n", "").Should().EndWith("⬛⬛🟩⬜⬜");
        description.Should().Contain("Last 30 days: **1/30**");
    }
}
