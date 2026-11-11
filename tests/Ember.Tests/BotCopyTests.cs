using Ember.Bot.Modules;
using Ember.Core.Models;
using FluentAssertions;

namespace Ember.Tests;

public class BotCopyTests
{
    [Theory]
    [InlineData("9pm", 21, 0)]
    [InlineData("9:30 PM", 21, 30)]
    [InlineData("9:30pm", 21, 30)]
    [InlineData("12am", 0, 0)]
    [InlineData(" 21:30 ", 21, 30)]
    [InlineData("9:05", 9, 5)]
    public void ReminderTime_AcceptsTwelveAndTwentyFourHourInput(string input, int hour, int minute)
    {
        ReminderSetupModule.TryParseTime(input, out var time).Should().BeTrue();
        time.Should().Be(new TimeOnly(hour, minute));
    }

    [Theory]
    [InlineData("25:00")]
    [InlineData("13pm")]
    [InlineData("soon")]
    public void ReminderTime_RefusesWhatIsNoClockTime(string input)
        => ReminderSetupModule.TryParseTime(input, out _).Should().BeFalse();

    [Fact]
    public void ReminderConfirmation_NamesTheWeekdaysOfAWeekdaysHabit()
    {
        var weekdays = new Habit { FrequencyType = FrequencyType.Weekdays, Days = ScheduleDays.Mon | ScheduleDays.Wed };

        ReminderSetupModule.ScheduleText(weekdays).Should().Be("on Mon, Wed");
        ReminderSetupModule.ScheduleText(new Habit()).Should().Be("every day");
        ReminderSetupModule.ScheduleText(new Habit { FrequencyType = FrequencyType.Weekly, WeeklyTarget = 3 })
            .Should().Be("on days you haven't checked in yet, until you've done it 3 times this week,");
    }

    [Fact]
    public void Streak_OfOneDay_IsSingular()
    {
        HabitModule.StreakText(1).Should().Be("Streak: **1** day");
        HabitModule.StreakText(2).Should().Be("Streak: **2** days");
    }
}
