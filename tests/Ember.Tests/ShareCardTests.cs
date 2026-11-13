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

        var description = HabitSelectModule.BuildShareEmbed(Ember.Bot.BotTexts.English, habit, 1, "nico", HabitFactory.Today, lowDays, showStreaks: true).Description;
        var grid = description.Split("\n\n")[1];

        grid.Should().NotContain("🟥").And.NotContain("🌙");
        grid.Replace("\n", "").Should().EndWith("⬛⬛🟩⬜⬜");
        description.Should().Contain("Last 30 days: **1/30**");
    }

    [Fact]
    public void ShareCard_WithStreaksOn_LeadsWithTheStreakAndShowsTheBest()
    {
        var habit = HabitFactory.Make((0, true), (1, true), (2, true));

        var description = HabitSelectModule.BuildShareEmbed(Ember.Bot.BotTexts.English, habit, 1, "nico", HabitFactory.Today, new HashSet<DateOnly>(), showStreaks: true).Description;

        description.Should().StartWith("**3-day streak** 🔥\n")
            .And.EndWith("Last 30 days: **3/30** · Best ever: **3** · Total: **3**");
    }

    [Fact]
    public void ShareCard_WithStreaksOff_LeadsWithTheLast30DaysAndShowsNoStreak()
    {
        var habit = HabitFactory.Make((0, true), (1, true), (2, true));

        var description = HabitSelectModule.BuildShareEmbed(Ember.Bot.BotTexts.English, habit, 1, "nico", HabitFactory.Today, new HashSet<DateOnly>(), showStreaks: false).Description;

        description.Should().StartWith("**3 of the last 30 days**\n")
            .And.EndWith("Last 30 days: **3/30** · Total: **3**");
        description.Should().NotContainAny("streak", "Best", "🔥");
    }

    [Theory]
    [InlineData(true, "Streak: **2** days · Last 7: **2/7**")]
    [InlineData(false, "Last 7: **2/7**")]
    public void ListProgress_ShowsTheStreakOnlyWhenStreaksAreOn(bool showStreaks, string expected)
    {
        var habit = HabitFactory.Make((0, true), (1, true));

        HabitModule.ListProgress(Ember.Bot.BotTexts.English, habit, HabitFactory.Today, 1, new HashSet<DateOnly>(), TimeZoneInfo.Utc, showStreaks)
            .Should().Be(expected);
    }
}
