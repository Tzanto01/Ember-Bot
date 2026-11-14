using Discord;
using Ember.Bot.Jobs;
using Ember.Bot.Modules;
using Ember.Bot.Services;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

/// <summary>Contract v1.8: reminder buttons close, and the one second reminder.</summary>
[Collection("Integration")]
public class ReminderMessageTests
{
    private const long DiscordUser = 10;
    private static readonly ulong Channel = TestDiscordDmSender.ChannelOf(DiscordUser);

    // Friday 2027-01-15, 09:00 in Berlin (UTC+1).
    private static readonly DateTimeOffset Now = new(2027, 1, 15, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly Today = new(2027, 1, 15);

    private static async Task<IntegrationTestHost> CreateHostAsync(FakeTimeProvider time, int secondReminderMinutes, params Habit[] habits)
    {
        var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Users.Add(new User
            {
                Id = TestUsers.Id(DiscordUser),
                Logins = TestUsers.Discord(DiscordUser),
                DiscordReminders = true,
                Timezone = "Europe/Berlin",
                SecondReminderMinutes = secondReminderMinutes,
                HealthDataConsentAt = Now.UtcDateTime,
                ConsentPolicyVersion = HabitService.CurrentConsentPolicyVersion,
            });
            db.Habits.AddRange(habits);
            await db.SaveChangesAsync();
        });
        return host;
    }

    private static Habit DueHabit(int id, TimeOnly? reminderTime = null, DateTime? nextUtc = null) => new()
    {
        Id = id,
        UserId = TestUsers.Id(DiscordUser),
        Name = $"Habit {id}",
        ReminderTime = reminderTime ?? new TimeOnly(9, 0),
        NextReminderUtc = nextUtc ?? Now.UtcDateTime,
        CreatedAt = Now.UtcDateTime.AddDays(-30),
    };

    private static Task RunJobAsync(IntegrationTestHost host)
        => ActivatorUtilities.CreateInstance<ReminderDispatchJob>(host.Host.Services).RunAsync();

    private static Task<List<ReminderMessage>> OpenMessagesAsync(IntegrationTestHost host)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().ReminderMessages.AsNoTracking().ToListAsync());

    private static Task<DateTime?> SecondReminderAsync(IntegrationTestHost host, int habitId)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits
            .Where(h => h.Id == habitId).Select(h => h.SecondReminderUtc).SingleAsync());

    private static Task CheckInAsync(IntegrationTestHost host, int habitId)
        => host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>()
            .CheckInAsync(TestUsers.Id(DiscordUser), habitId, Today, completed: true));

    private static IEnumerable<string?> ButtonIds(MessageComponent? components)
        => components!.Components.OfType<ActionRowComponent>().SelectMany(r => r.Components).OfType<ButtonComponent>().Select(b => b.CustomId);

    [Fact]
    public async Task A_sent_reminder_is_remembered_and_closes_at_10_the_next_morning()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, 0, DueHabit(1));

        await RunJobAsync(host);

        var first = host.Discord.Messages.Should().ContainSingle().Subject;
        (await OpenMessagesAsync(host)).Should().ContainSingle().Which.Should().BeEquivalentTo(
            new { HabitId = (int?)1, RoutineId = (int?)null, Date = Today, ChannelId = Channel, first.MessageId });

        time.SetUtcNow(new DateTimeOffset(2027, 1, 16, 8, 59, 0, TimeSpan.Zero));
        await RunJobAsync(host);
        host.Discord.Changes.Should().BeEmpty();

        time.Advance(TimeSpan.FromMinutes(1));
        await RunJobAsync(host);

        host.Discord.Changes.Should().Equal(new ChangedDiscordDm(Channel, first.MessageId, DiscordDmReminderChannel.ClosedLine(Ember.Bot.BotTexts.English)));
        (await OpenMessagesAsync(host)).Should().ContainSingle().Which.Date.Should().Be(Today.AddDays(1));
    }

    [Fact]
    public async Task A_reminder_closes_as_logged_once_its_habit_is_done_on_the_web()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, 0, DueHabit(1));
        await RunJobAsync(host);
        var first = host.Discord.Messages.Single();

        await CheckInAsync(host, 1);
        time.Advance(TimeSpan.FromMinutes(1));
        await RunJobAsync(host);
        await RunJobAsync(host);

        host.Discord.Changes.Should().Equal(new ChangedDiscordDm(Channel, first.MessageId, DiscordDmReminderChannel.LoggedLine(Ember.Bot.BotTexts.English)));
        (await OpenMessagesAsync(host)).Should().BeEmpty();
    }

    [Fact]
    public async Task A_remembered_reminder_is_deleted_with_its_habit()
    {
        await using var host = await CreateHostAsync(new FakeTimeProvider(Now), 0, DueHabit(1));
        await RunJobAsync(host);

        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().DeleteHabitAsync(TestUsers.Id(DiscordUser), 1));

        (await OpenMessagesAsync(host)).Should().BeEmpty();
    }

    [Fact]
    public async Task Done_or_skip_after_10_the_next_morning_closes_the_message_instead_of_logging()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, 0, DueHabit(1));
        var sent = Now.ToUnixTimeSeconds().ToString();
        var buttons = new ComponentBuilder()
            .WithButton("Done ✅", $"checkin:done:1:{sent}", ButtonStyle.Success)
            .WithButton("Skip for today", $"checkin:skip:1:{sent}", ButtonStyle.Secondary)
            .Build().Components;
        Task<string?> ExpiredLine(string timestamp) => host.WithScopeAsync(sp =>
            CheckInButtonModule.ExpiredLineAsync(Ember.Bot.BotTexts.English, sp.GetRequiredService<HabitService>(), time, DiscordUser, timestamp, buttons));

        time.SetUtcNow(new DateTimeOffset(2027, 1, 16, 8, 59, 0, TimeSpan.Zero));
        (await ExpiredLine(sent)).Should().BeNull();

        time.Advance(TimeSpan.FromMinutes(1));
        (await ExpiredLine(sent)).Should().Be(DiscordDmReminderChannel.ClosedLine(Ember.Bot.BotTexts.English));
        (await ExpiredLine("not-a-timestamp")).Should().BeNull();

        await CheckInAsync(host, 1);
        (await ExpiredLine(sent)).Should().Be(DiscordDmReminderChannel.LoggedLine(Ember.Bot.BotTexts.English));
    }

    [Fact]
    public async Task The_second_reminder_follows_once_after_the_delay_and_replaces_the_first_message()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, 30, DueHabit(1));
        await RunJobAsync(host);
        var first = host.Discord.Messages.Single();

        time.Advance(TimeSpan.FromMinutes(29));
        await RunJobAsync(host);
        host.Discord.Messages.Should().HaveCount(1);

        time.Advance(TimeSpan.FromMinutes(1));
        await RunJobAsync(host);

        var second = host.Discord.Messages.Should().HaveCount(2).And.Subject.Last();
        second.Text.Should().Be("🔔 One more nudge for **Habit 1**, in case the first one got buried. Did you get to it today?");
        var at = time.GetUtcNow().ToUnixTimeSeconds();
        ButtonIds(second.Components).Should().Equal($"checkin:done:1:{at}", $"checkin:skip:1:{at}", $"checkin:snooze:1:{at}", "discordreminders:stop:10");
        host.Discord.Changes.Should().Equal(new ChangedDiscordDm(Channel, first.MessageId, null));
        (await OpenMessagesAsync(host)).Should().ContainSingle().Which.MessageId.Should().Be(second.MessageId);

        time.Advance(TimeSpan.FromHours(3));
        await RunJobAsync(host);
        host.Discord.Messages.Should().HaveCount(2);
    }

    [Fact]
    public async Task A_first_message_that_cannot_be_deleted_is_closed_instead()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, 15, DueHabit(1));
        host.Discord.DeleteSucceeds = false;
        await RunJobAsync(host);
        var first = host.Discord.Messages.Single();

        time.Advance(TimeSpan.FromMinutes(15));
        await RunJobAsync(host);

        host.Discord.Changes.Should().Equal(
            new ChangedDiscordDm(Channel, first.MessageId, null),
            new ChangedDiscordDm(Channel, first.MessageId, DiscordDmReminderChannel.ClosedLine(Ember.Bot.BotTexts.English)));
        (await OpenMessagesAsync(host)).Should().ContainSingle().Which.MessageId.Should().NotBe(first.MessageId);
    }

    [Fact]
    public async Task No_second_reminder_when_the_habit_was_done_or_paused_meanwhile_or_the_setting_is_off()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, 15, DueHabit(1), DueHabit(2));
        await RunJobAsync(host);
        host.Discord.Messages.Should().HaveCount(2);

        await CheckInAsync(host, 1);
        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().PauseHabitAsync(TestUsers.Id(DiscordUser), 2, Today));
        time.Advance(TimeSpan.FromMinutes(15));
        await RunJobAsync(host);

        host.Discord.Messages.Should().HaveCount(2);
        (await SecondReminderAsync(host, 1)).Should().BeNull();
        (await SecondReminderAsync(host, 2)).Should().BeNull();
    }

    [Fact]
    public async Task No_second_reminder_once_a_weekly_habits_target_is_met_meanwhile()
    {
        var weekly = DueHabit(1);
        weekly.FrequencyType = FrequencyType.Weekly;
        weekly.WeeklyTarget = 2;
        weekly.Logs.Add(new HabitLog { Date = Today.AddDays(-3), Completed = true });
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, 15, weekly);
        await RunJobAsync(host);
        host.Discord.Messages.Should().ContainSingle();
        (await SecondReminderAsync(host, 1)).Should().NotBeNull();

        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>()
            .CheckInAsync(TestUsers.Id(DiscordUser), 1, Today.AddDays(-1), completed: true));
        time.Advance(TimeSpan.FromMinutes(15));
        await RunJobAsync(host);

        host.Discord.Messages.Should().ContainSingle();
        (await SecondReminderAsync(host, 1)).Should().BeNull();
    }

    [Fact]
    public async Task No_second_reminder_is_planned_while_the_setting_is_off()
    {
        await using var host = await CreateHostAsync(new FakeTimeProvider(Now), 0, DueHabit(1));

        await RunJobAsync(host);

        (await SecondReminderAsync(host, 1)).Should().BeNull();
    }

    [Fact]
    public async Task A_snooze_replaces_the_pending_second_reminder()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, 30, DueHabit(1));
        await RunJobAsync(host);
        (await SecondReminderAsync(host, 1)).Should().Be(Now.UtcDateTime.AddMinutes(30));

        (await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().SnoozeReminderAsync((ulong)DiscordUser, 1, Now))).Should().BeTrue();
        time.Advance(TimeSpan.FromMinutes(30));
        await RunJobAsync(host);
        host.Discord.Messages.Should().HaveCount(1);

        time.Advance(TimeSpan.FromMinutes(30));
        await RunJobAsync(host);
        host.Discord.Messages.Should().HaveCount(2).And.Subject.Last().Text.Should().Contain("Snoozed reminder");

        time.Advance(TimeSpan.FromMinutes(30));
        await RunJobAsync(host);
        host.Discord.Messages.Should().HaveCount(2);
    }

    [Fact]
    public async Task No_second_reminder_on_another_local_day()
    {
        var lateUtc = new DateTime(2027, 1, 15, 22, 45, 0, DateTimeKind.Utc);
        var late = DueHabit(1, new TimeOnly(23, 45), lateUtc);
        var crossed = DueHabit(2, nextUtc: new DateTime(2027, 1, 16, 8, 0, 0, DateTimeKind.Utc));
        crossed.SecondReminderUtc = new DateTime(2027, 1, 15, 22, 50, 0, DateTimeKind.Utc);
        var time = new FakeTimeProvider(new DateTimeOffset(lateUtc));
        await using var host = await CreateHostAsync(time, 30, late, crossed);

        await RunJobAsync(host);
        host.Discord.Messages.Should().ContainSingle().Which.Text.Should().Contain("Habit 1");
        (await SecondReminderAsync(host, 1)).Should().BeNull();

        time.Advance(TimeSpan.FromMinutes(30));
        await RunJobAsync(host);

        host.Discord.Messages.Should().ContainSingle();
        (await SecondReminderAsync(host, 2)).Should().BeNull();
    }

    [Fact]
    public async Task A_routine_gets_one_second_reminder_listing_what_is_still_open_and_it_closes_once_all_are_done()
    {
        var time = new FakeTimeProvider(Now);
        Habit Member(int id, int position) => new()
        {
            Id = id,
            UserId = TestUsers.Id(DiscordUser),
            Name = $"Habit {id}",
            RoutinePosition = position,
            CreatedAt = Now.UtcDateTime.AddDays(-30),
        };
        var done = Member(2, 1);
        done.Logs.Add(new HabitLog { Date = Today, Count = 1, Completed = true });
        await using var host = await CreateHostAsync(time, 15, Member(1, 0), done);
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Routines.Add(new Routine
            {
                Id = 1,
                UserId = TestUsers.Id(DiscordUser),
                Name = "Morning",
                ReminderTime = new TimeOnly(9, 0),
                NextReminderUtc = Now.UtcDateTime,
            });
            await db.SaveChangesAsync();
            await db.Habits.ExecuteUpdateAsync(s => s.SetProperty(h => h.RoutineId, 1));
        });
        await RunJobAsync(host);
        var first = host.Discord.Messages.Single();

        time.Advance(TimeSpan.FromMinutes(15));
        await RunJobAsync(host);

        var second = host.Discord.Messages.Should().HaveCount(2).And.Subject.Last();
        second.Text.Should().Be("🔔 One more nudge for your **Morning** routine. Still open today:\n• Habit 1");
        ButtonIds(second.Components).Should().Equal($"checkin:done:1:{time.GetUtcNow().ToUnixTimeSeconds()}", "discordreminders:stop:10");
        host.Discord.Changes.Should().Equal(new ChangedDiscordDm(Channel, first.MessageId, null));
        (await OpenMessagesAsync(host)).Should().ContainSingle().Which.Should().BeEquivalentTo(
            new { HabitId = (int?)null, RoutineId = (int?)1, second.MessageId });

        await CheckInAsync(host, 1);
        time.Advance(TimeSpan.FromHours(1));
        await RunJobAsync(host);

        host.Discord.Messages.Should().HaveCount(2);
        host.Discord.Changes.Last().Should().Be(new ChangedDiscordDm(Channel, second.MessageId, DiscordDmReminderChannel.LoggedLine(Ember.Bot.BotTexts.English)));
        (await OpenMessagesAsync(host)).Should().BeEmpty();
    }

    [Fact]
    public async Task A_routine_reminder_whose_open_habit_is_paused_is_not_closed_as_logged_and_closes_at_10_the_next_morning()
    {
        var time = new FakeTimeProvider(Now);
        Habit Member(int id, int position) => new()
        {
            Id = id,
            UserId = TestUsers.Id(DiscordUser),
            Name = $"Habit {id}",
            RoutinePosition = position,
            CreatedAt = Now.UtcDateTime.AddDays(-30),
        };
        var done = Member(2, 1);
        done.Logs.Add(new HabitLog { Date = Today, Count = 1, Completed = true });
        await using var host = await CreateHostAsync(time, 0, Member(1, 0), done);
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Routines.Add(new Routine
            {
                Id = 1,
                UserId = TestUsers.Id(DiscordUser),
                Name = "Morning",
                ReminderTime = new TimeOnly(9, 0),
                NextReminderUtc = Now.UtcDateTime,
            });
            await db.SaveChangesAsync();
            await db.Habits.ExecuteUpdateAsync(s => s.SetProperty(h => h.RoutineId, 1));
        });
        await RunJobAsync(host);
        var first = host.Discord.Messages.Single();

        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().PauseHabitAsync(TestUsers.Id(DiscordUser), 1, Today));
        time.Advance(TimeSpan.FromMinutes(1));
        await RunJobAsync(host);
        host.Discord.Changes.Should().BeEmpty();

        time.SetUtcNow(new DateTimeOffset(2027, 1, 16, 9, 0, 0, TimeSpan.Zero));
        await RunJobAsync(host);

        host.Discord.Changes.Should().Equal(new ChangedDiscordDm(Channel, first.MessageId, DiscordDmReminderChannel.ClosedLine(Ember.Bot.BotTexts.English)));
    }
}
