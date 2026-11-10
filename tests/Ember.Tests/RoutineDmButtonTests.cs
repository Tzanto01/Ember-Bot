using Discord;
using Ember.Bot.Modules;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

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

    [Fact]
    public async Task A_routine_dm_with_25_long_names_stays_under_discords_limit_and_keeps_every_button()
    {
        var sender = new TestDiscordDmSender();
        var pending = Enumerable.Range(1, 25).Select(i => new RoutineHabit(i, $"Habit {i:00} " + new string('x', 91))).ToList();

        await new DiscordDmReminderChannel(sender, TimeProvider.System, new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
                NullLogger<DiscordDmReminderChannel>.Instance)
            .SendAsync(new Reminder(Guid.NewGuid(), 42, 7, "Morning", 0, false, new DateOnly(2027, 1, 15), pending));

        var dm = sender.Messages.Should().ContainSingle().Subject;
        dm.Text!.Length.Should().BeLessThan(2000);
        dm.Text.Should().Contain("Habit 01").And.MatchRegex(@"\nand \d+ more\n").And.NotContain("Habit 25");
        Ids(dm.Components).Should().HaveCount(25);
    }
}
