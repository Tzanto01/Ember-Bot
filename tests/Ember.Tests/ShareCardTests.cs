using Ember.Bot.Modules;
using FluentAssertions;

namespace Ember.Tests;

public class ShareCardTests
{
    [Fact]
    public void ShareCard_ShowsGapsNeutrally_AndLowDaysAsMoons()
    {
        var habit = HabitFactory.Make((2, true), (4, false));
        var lowDays = new HashSet<DateOnly> { HabitFactory.Today.AddDays(-3) };

        var grid = HabitSelectModule.BuildShareEmbed(habit, 1, "nico", HabitFactory.Today, lowDays).Description.Split("\n\n")[1];

        grid.Should().NotContain("🟥");
        grid.Replace("\n", "").Should().EndWith("⬛🌙🟩⬜⬜");
    }
}
