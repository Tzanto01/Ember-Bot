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

[Collection("Integration")]
public class DiscordReminderAskTests
{
    private static readonly DateTimeOffset Now = new(2027, 1, 15, 8, 0, 0, TimeSpan.Zero);

    private static User DiscordUser(long id, bool? answer = null, bool reminder = true)
    {
        var user = new User { Id = TestUsers.Id(id), Logins = TestUsers.Discord(id), DiscordReminders = answer };
        user.Habits.Add(new Habit { Name = "Stretch", ReminderTimes = reminder ? [new TimeOnly(9, 0)] : [] });
        return user;
    }

    private static async Task<IntegrationTestHost> CreateAsync(params User[] users)
    {
        var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(Now));
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Users.AddRange(users);
            return await db.SaveChangesAsync();
        });
        return host;
    }

    private static Task RunAskAsync(IntegrationTestHost host)
        => ActivatorUtilities.CreateInstance<DiscordReminderAskJob>(host.Host.Services).RunAsync();

    private static Task<User> UserAsync(IntegrationTestHost host, long id)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users.AsNoTracking().SingleAsync(u => u.Id == TestUsers.Id(id)));

    [Fact]
    public async Task Asks_once_only_linked_users_who_never_answered_and_have_a_reminder_time()
    {
        var routineOnly = DiscordUser(40, reminder: false);
        routineOnly.Routines.Add(new Routine { Name = "Morning", ReminderTime = new TimeOnly(7, 0) });
        var webOnly = new User { Id = TestUsers.Id(60), UserName = "web60@example.com" };
        webOnly.Habits.Add(new Habit { Name = "Read", ReminderTimes = [new TimeOnly(9, 0)] });
        await using var host = await CreateAsync(DiscordUser(10), DiscordUser(20, answer: true), DiscordUser(30, reminder: false), routineOnly,
            DiscordUser(50, answer: false), webOnly);

        await RunAskAsync(host);
        await RunAskAsync(host);

        host.Discord.Messages.Select(m => m.UserId).Should().BeEquivalentTo([10UL, 40UL]);
        var ask = host.Discord.Messages.First(m => m.UserId == 10);
        ask.Text.Should().Be(DiscordRemindersModule.AskText(Ember.Bot.BotTexts.English));
        ask.Components!.Components.OfType<Discord.ActionRowComponent>().SelectMany(r => r.Components).OfType<Discord.ButtonComponent>().Select(b => (b.Label, b.CustomId))
            .Should().Equal(("Yes, remind me here", "discordreminders:yes:10"), ("No thanks", "discordreminders:no:10"));
        (await UserAsync(host, 10)).DiscordRemindersAskedAt.Should().Be(Now.UtcDateTime);
        (await UserAsync(host, 10)).DiscordReminders.Should().BeNull();
    }

    [Fact]
    public async Task An_undelivered_ask_is_never_repeated()
    {
        await using var host = await CreateAsync(DiscordUser(10));
        host.Discord.Deliver = _ => DeliveryOutcome.Undeliverable;

        await RunAskAsync(host);
        await RunAskAsync(host);

        host.Discord.Messages.Should().ContainSingle();
        (await UserAsync(host, 10)).DiscordRemindersAskedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task An_ask_that_fails_transiently_is_sent_again_next_run()
    {
        await using var host = await CreateAsync(DiscordUser(10));
        var attempts = 0;
        host.Discord.Deliver = _ => ++attempts == 1 ? throw new HttpRequestException("503") : DeliveryOutcome.Delivered;

        await RunAskAsync(host);
        await RunAskAsync(host);
        await RunAskAsync(host);

        host.Discord.Messages.Should().HaveCount(2);
        (await UserAsync(host, 10)).DiscordRemindersAskedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task A_reminder_set_through_the_bot_turns_unanswered_discord_reminders_on_and_tells_a_no_they_stay_off()
    {
        var unanswered = DiscordUser(10);
        var declined = DiscordUser(20, answer: false);
        foreach (var habit in unanswered.Habits.Concat(declined.Habits)) habit.NextReminderUtc = Now.UtcDateTime;
        await using var host = await CreateAsync(unanswered, declined);
        var note = (ulong discordId) => host.WithScopeAsync(sp =>
            ReminderSetupModule.DiscordRemindersNoteAsync(Ember.Bot.BotTexts.English, sp.GetRequiredService<HabitService>(), discordId));

        (await note(10)).Should().BeEmpty();
        (await note(20)).Should().Be(DiscordRemindersModule.OffText(Ember.Bot.BotTexts.English));
        await RunAskAsync(host);
        await ActivatorUtilities.CreateInstance<ReminderDispatchJob>(host.Host.Services).RunAsync();

        host.Discord.Messages.Select(m => m.UserId).Should().Equal(10UL);
        host.Discord.Messages.Single().Text.Should().NotBe(DiscordRemindersModule.AskText(Ember.Bot.BotTexts.English));
        var user = await UserAsync(host, 10);
        (user.DiscordReminders, user.DiscordRemindersAskedAt).Should().Be((true, Now.UtcDateTime));
        (await UserAsync(host, 20)).DiscordReminders.Should().BeFalse();
    }

    [Fact]
    public async Task Each_run_asks_at_most_twenty_users()
    {
        await using var host = await CreateAsync(Enumerable.Range(1, HabitService.MaxDiscordAsksPerRun + 5).Select(i => DiscordUser(i)).ToArray());

        await RunAskAsync(host);
        host.Discord.Messages.Should().HaveCount(HabitService.MaxDiscordAsksPerRun);
        await RunAskAsync(host);

        host.Discord.Messages.Select(m => m.UserId).Should().OnlyHaveUniqueItems().And.HaveCount(HabitService.MaxDiscordAsksPerRun + 5);
    }

    [Fact]
    public async Task Only_the_owner_can_answer_and_the_latest_answer_wins()
    {
        await using var host = await CreateAsync(DiscordUser(10));
        var answer = (ulong clicker, bool yes) => host.WithScopeAsync(sp =>
            DiscordRemindersModule.TryAnswerAsync(sp.GetRequiredService<HabitService>(), "10", clicker, yes));

        (await answer(11, true)).Should().BeFalse();
        (await UserAsync(host, 10)).DiscordReminders.Should().BeNull();
        (await answer(10, false)).Should().BeTrue();
        (await UserAsync(host, 10)).DiscordReminders.Should().BeFalse();
        (await answer(10, true)).Should().BeTrue();

        (await UserAsync(host, 10)).DiscordReminders.Should().BeTrue();
        DiscordRemindersModule.TurnOnButton(Ember.Bot.BotTexts.English, 10).Components.OfType<Discord.ActionRowComponent>().SelectMany(r => r.Components).OfType<Discord.ButtonComponent>()
            .Should().ContainSingle(b => b.CustomId == "discordreminders:yes:10");
    }

    [Fact]
    public async Task The_reminders_command_sets_the_answer_and_records_the_ask()
    {
        var earlier = Now.UtcDateTime.AddDays(-3);
        var asked = DiscordUser(10);
        asked.DiscordRemindersAskedAt = earlier;
        await using var host = await CreateAsync(DiscordUser(20), asked);
        var set = (ulong id, bool on) => host.WithScopeAsync(sp =>
            DiscordRemindersModule.SetFromCommandAsync(sp.GetRequiredService<HabitService>(), id, on, null));

        await set(20, false);
        await set(10, false);

        var user = await UserAsync(host, 20);
        (user.DiscordReminders, user.DiscordRemindersAskedAt).Should().Be((false, Now.UtcDateTime));
        (await UserAsync(host, 10)).DiscordRemindersAskedAt.Should().Be(earlier);

        await set(20, true);
        (await UserAsync(host, 20)).DiscordReminders.Should().BeTrue();
    }

    [Fact]
    public async Task The_reminders_command_creates_the_account_of_a_new_discord_user_in_their_language()
    {
        await using var host = await CreateAsync();

        await host.WithScopeAsync(sp => DiscordRemindersModule.SetFromCommandAsync(sp.GetRequiredService<HabitService>(), 77, false, "de"));

        var user = await host.WithScopeAsync(async sp =>
        {
            var id = await TestUsers.UserIdAsync(sp, 77);
            return await sp.GetRequiredService<EmberDbContext>().Users.AsNoTracking().SingleAsync(u => u.Id == id);
        });
        (user.Language, user.DiscordReminders, user.DiscordRemindersAskedAt).Should().Be(("de", false, Now.UtcDateTime));
    }

    [Fact]
    public async Task Turning_discord_off_leaves_browsers_phones_and_exclusions_as_they_were()
    {
        var user = DiscordUser(10, answer: true);
        user.PushSubscriptions.Add(new PushSubscription { Endpoint = "https://push.example/1", Enabled = true });
        user.ReminderPhones.Add(new ReminderPhone { InstallId = "install-1", Label = "Pixel", Enabled = true });
        user.Habits.Single().ReminderExclusions = ["browser-9"];
        await using var host = await CreateAsync(user);

        await host.WithScopeAsync(sp => DiscordRemindersModule.SetFromCommandAsync(sp.GetRequiredService<HabitService>(), 10, false, null));

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            (await db.PushSubscriptions.SingleAsync()).Enabled.Should().BeTrue();
            (await db.ReminderPhones.SingleAsync()).Enabled.Should().BeTrue();
            (await db.Habits.SingleAsync()).ReminderExclusions.Should().Equal("browser-9");
        });
    }

    [Theory]
    [InlineData(null, false, false, false)]
    [InlineData(false, false, false, false)]
    [InlineData(true, false, false, true)]
    [InlineData(true, true, false, false)]
    [InlineData(true, false, true, false)]
    public void The_resolver_sends_to_discord_only_after_yes_while_not_paused_and_not_excluded(bool? answer, bool paused, bool excluded,
        bool expected)
    {
        var user = new User { Logins = TestUsers.Discord(10), DiscordReminders = answer, DmRemindersPausedAt = paused ? Now.UtcDateTime : null };

        ReminderDestinations.Resolve(user, excluded ? [ReminderDestinations.Discord] : []).Discord.Should().Be(expected);
        ReminderDestinations.Resolve(new User { DiscordReminders = true }, []).Discord.Should().BeFalse();
    }

    [Fact]
    public void The_resolver_counts_each_enabled_browser_that_is_not_excluded()
    {
        var user = new User
        {
            PushSubscriptions = [new PushSubscription { Id = 3 }, new PushSubscription { Id = 1 }, new PushSubscription { Id = 2, Enabled = false }],
        };

        ReminderDestinations.Resolve(user, ["browser-3"]).PushSubscriptionIds.Should().Equal(1);
        ReminderDestinations.Resolve(user, []).PushSubscriptionIds.Should().Equal(1, 3);
        ReminderDestinations.LegacyChannels(ReminderDestinations.Resolve(user, ["browser-1", "browser-3"])).Should().Equal("mobile");
        ReminderDestinations.LegacyChannels(new ReminderTargets(true, [1])).Should().Equal("discord", "webpush");
    }
}
