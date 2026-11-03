using Discord;
using Ember.Bot.Modules;
using FluentAssertions;

namespace Ember.Tests;

public class RoutineDmButtonTests
{
    private static IEnumerable<string?> Ids(MessageComponent? components)
        => components!.Components.OfType<ActionRowComponent>().SelectMany(r => r.Components).OfType<ButtonComponent>().Select(b => b.CustomId);

    private static MessageComponent RoutineDm() => new ComponentBuilder()
        .WithButton("Done: Water", "checkin:done:1:100", ButtonStyle.Success)
        .WithButton("Done: Stretch", "checkin:done:2:100", ButtonStyle.Success)
        .WithButton("Done: Read", "checkin:done:3:100", ButtonStyle.Success)
        .Build();

    [Fact]
    public void A_done_habit_leaves_the_routine_dm_and_the_others_stay_tappable()
        => Ids(CheckInButtonModule.RoutineButtonsAfterDone(RoutineDm().Components, "checkin:done:2:100", done: true))
            .Should().Equal("checkin:done:1:100", "checkin:done:3:100");

    [Fact]
    public void A_habit_still_partial_keeps_its_button()
        => Ids(CheckInButtonModule.RoutineButtonsAfterDone(RoutineDm().Components, "checkin:done:2:100", done: false))
            .Should().HaveCount(3);

    [Fact]
    public void A_single_habit_reminder_is_not_a_routine_dm()
    {
        var reminder = new ComponentBuilder()
            .WithButton("Done ✅", "checkin:done:1:100", ButtonStyle.Success)
            .WithButton("Skip ❌", "checkin:skip:1:100", ButtonStyle.Secondary)
            .Build();

        CheckInButtonModule.RoutineButtonsAfterDone(reminder.Components, "checkin:done:1:100", done: true).Should().BeNull();
    }
}
