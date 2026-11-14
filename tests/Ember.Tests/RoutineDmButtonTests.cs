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
            .WithButton("Skip for today", "checkin:skip:1:100", ButtonStyle.Secondary)
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
    private static IEnumerable<IReadOnlyCollection<string?>> Rows(MessageComponent c)
        => c.Components.OfType<ActionRowComponent>().Select(r => r.Components.OfType<ButtonComponent>().Select(b => b.CustomId).ToList());

    private static Task<TestDiscordDmSender> SendRoutineAsync(int pendingCount)
    {
        var sender = new TestDiscordDmSender();
        var pending = Enumerable.Range(1, pendingCount).Select(i => new RoutineHabit(i, $"Habit {i}")).ToList();
        return new DiscordDmReminderChannel(sender, TimeProvider.System, new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
                NullLogger<DiscordDmReminderChannel>.Instance)
            .SendAsync(new Reminder(Guid.NewGuid(), 42, 7, "Morning", 0, false, new DateOnly(2027, 1, 15), pending))
            .ContinueWith(_ => sender);
    }

    [Theory]
    [InlineData(2, 1)]
    [InlineData(5, 1)]
    [InlineData(6, 2)]
    [InlineData(24, 4)]
    [InlineData(30, 4)]
    public async Task A_routine_dm_ends_with_the_stop_button_in_its_own_valid_row_and_never_exceeds_24_done_buttons(int pending, int stopRow)
    {
        var rows = Rows((await SendRoutineAsync(pending)).Messages.Single().Components!).ToList();

        rows.Should().OnlyContain(r => r.Count <= 5);
        rows.SelectMany(r => r).Count(id => id!.StartsWith("checkin:done:")).Should().Be(Math.Min(pending, 24));
        rows[stopRow].Should().Contain("discordreminders:stop:42");
        rows.SelectMany(r => r).Count().Should().BeLessThanOrEqualTo(25);
        rows.SelectMany(r => r).Should().ContainSingle(id => id!.StartsWith("discordreminders:stop:"));
    }

    [Fact]
    public void After_the_stop_button_is_used_every_other_button_stays_and_turn_on_takes_its_place()
    {
        var t = Ember.Bot.BotTexts.English;
        var dm = new ComponentBuilder()
            .WithButton("Done ✅", "checkin:done:1:100", ButtonStyle.Success)
            .WithButton("Skip", "checkin:skip:1:100", ButtonStyle.Secondary)
            .WithButton("Snooze", "checkin:snooze:1:100", ButtonStyle.Secondary)
            .WithButton(DiscordRemindersModule.StopButton(t, 42), row: 1)
            .Build();

        var after = DiscordRemindersModule.AfterStop(dm.Components, t, 42);

        Rows(after).Select(r => string.Join(" ", r)).Should().Equal(
            "checkin:done:1:100 checkin:skip:1:100 checkin:snooze:1:100", "discordreminders:yes:42");
    }

    [Fact]
    public void A_done_habit_leaves_the_routine_dm_but_the_stop_button_stays()
    {
        var dm = new ComponentBuilder()
            .WithButton("Done: Water", "checkin:done:1:100", ButtonStyle.Success)
            .WithButton("Done: Read", "checkin:done:2:100", ButtonStyle.Success)
            .WithButton(DiscordRemindersModule.StopButton(Ember.Bot.BotTexts.English, 42), row: 1)
            .Build();

        Ids(CheckInButtonModule.RoutineButtonsAfterDone(dm.Components, "checkin:done:1:100", done: true))
            .Should().Equal("checkin:done:2:100", "discordreminders:stop:42");
    }
}
