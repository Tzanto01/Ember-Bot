using Ember.Core.Services;
using FluentAssertions;

namespace Ember.Tests;

public class HabitTemplatesTests
{
    [Fact]
    public void AllTemplates_HaveUniqueKeys()
    {
        var keys = HabitTemplates.All.Select(t => t.Key).ToList();
        keys.Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public void AllTemplates_HaveNonEmptyDisplayNameAndDescription()
    {
        foreach (var t in HabitTemplates.All)
        {
            t.DisplayName.Should().NotBeNullOrWhiteSpace(because: $"template '{t.Key}' needs a display name");
            t.Description.Should().NotBeNullOrWhiteSpace(because: $"template '{t.Key}' needs a description");
        }
    }

    [Fact]
    public void AllWeeklyTemplates_HaveWeeklyTargetBetweenOneAndSeven()
    {
        var weekly = HabitTemplates.All.Where(t => t.Frequency == HabitTemplates.FrequencyHint.Weekly);
        foreach (var t in weekly)
        {
            t.WeeklyTarget.Should().BeInRange(1, 7,
                because: $"template '{t.Key}' has a weekly target outside 1–7");
        }
    }

    [Fact]
    public void Find_KnownKey_ReturnsTemplate()
    {
        var result = HabitTemplates.Find("medication");
        result.Should().NotBeNull();
        result!.Key.Should().Be("medication");
    }

    [Fact]
    public void Find_UnknownKey_ReturnsNull()
    {
        HabitTemplates.Find("not_a_real_template").Should().BeNull();
    }

    [Fact]
    public void Find_NullKey_ReturnsNull()
    {
        HabitTemplates.Find(null!).Should().BeNull();
    }

    [Fact]
    public void AllTemplates_UseSentenceCase_NoEmDash_AndDontSoundLikeARoutine()
    {
        foreach (var t in HabitTemplates.All)
        {
            var words = t.DisplayName[(t.DisplayName.IndexOf(' ') + 1)..];
            words[1..].Should().NotContainAny(Enumerable.Range('A', 26).Select(c => ((char)c).ToString()), t.Key);
            (t.DisplayName + t.Description).Should().NotContain("—", t.Key);
            t.DisplayName.Should().NotContainEquivalentOf("routine", t.Key);
        }
    }
}
