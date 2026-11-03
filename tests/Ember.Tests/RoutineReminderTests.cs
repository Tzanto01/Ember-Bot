using Discord;
using Ember.Bot.Jobs;
using Ember.Core.Data;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Integration")]
public class RoutineReminderTests
{
    private const long DiscordUser = 10;

    // Friday 2027-01-15, 09:00 in Berlin (UTC+1).
    private static readonly DateTimeOffset Now = new(2027, 1, 15, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly Today = new(2027, 1, 15);
    private static readonly DateTime TomorrowNineBerlin = new(2027, 1, 16, 8, 0, 0, DateTimeKind.Utc);
    private static readonly TimeOnly Nine = new(9, 0);

    private static Habit Member(int id, int position) => new()
    {
        Id = id,
        UserId = TestUsers.Id(DiscordUser),
        Name = $"Habit {id}",
        RoutineId = 1,
        RoutinePosition = position,
        CreatedAt = Now.UtcDateTime.AddDays(-30),
    };

    private static async Task<IntegrationTestHost> CreateHostAsync(FakeTimeProvider time, DateTime routineDueUtc, params Habit[] habits)
    {
        var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Users.Add(new User { Id = TestUsers.Id(DiscordUser), Logins = TestUsers.Discord(DiscordUser), Timezone = "Europe/Berlin" });
            db.Routines.Add(new Routine
            {
                Id = 1,
                UserId = TestUsers.Id(DiscordUser),
                Name = "Morning",
                ReminderTime = Nine,
                NextReminderUtc = routineDueUtc,
                ReminderChannels = ReminderChannels.Discord,
            });
            db.Habits.AddRange(habits);
            await db.SaveChangesAsync();
        });
        return host;
    }

    private static Task RunJobAsync(IntegrationTestHost host)
        => ActivatorUtilities.CreateInstance<ReminderDispatchJob>(host.Host.Services).RunAsync();

    private static Task<DateTime?> RoutineNextReminderAsync(IntegrationTestHost host)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Routines.Select(r => r.NextReminderUtc).SingleAsync());

    [Fact]
    public async Task DueRoutine_ListsOnlyPendingAndPartialMembersInOrder_WithADoneButtonEach()
    {
        var pending = Member(1, 1);
        var partial = Member(2, 0);
        partial.TimesPerDay = 3;
        partial.Logs.Add(new HabitLog { Date = Today, Count = 1, Completed = false });
        var done = Member(3, 2);
        done.Logs.Add(new HabitLog { Date = Today, Count = 1, Completed = true });
        var offday = Member(4, 3);
        offday.FrequencyType = FrequencyType.Weekdays;
        offday.Days = ScheduleDays.Mon;

        await using var host = await CreateHostAsync(new FakeTimeProvider(Now), Now.UtcDateTime, pending, partial, done, offday);

        await RunJobAsync(host);

        var dm = host.Discord.Messages.Should().ContainSingle().Subject;
        dm.UserId.Should().Be(DiscordUser);
        dm.Text.Should().Contain("Morning").And.Contain("Habit 1").And.Contain("Habit 2")
            .And.NotContain("Habit 3").And.NotContain("Habit 4");
        dm.Components!.Components.OfType<ActionRowComponent>().SelectMany(row => row.Components)
            .OfType<ButtonComponent>().Select(b => b.CustomId)
            .Should().Equal($"checkin:done:2:{Now.ToUnixTimeSeconds()}", $"checkin:done:1:{Now.ToUnixTimeSeconds()}");
        (await RoutineNextReminderAsync(host)).Should().Be(TomorrowNineBerlin);

        await RunJobAsync(host);
        host.Discord.Messages.Should().ContainSingle();
    }

    [Fact]
    public async Task DueRoutineWithNothingPending_SendsNothing_AndAdvances()
    {
        var done = Member(1, 0);
        done.Logs.Add(new HabitLog { Date = Today, Count = 1, Completed = true });
        var paused = Member(2, 1);
        paused.PausedUntil = Today;

        await using var host = await CreateHostAsync(new FakeTimeProvider(Now), Now.UtcDateTime, done, paused);

        await RunJobAsync(host);

        host.Discord.Messages.Should().BeEmpty();
        (await RoutineNextReminderAsync(host)).Should().Be(TomorrowNineBerlin);
    }

    [Fact]
    public async Task AMembersOwnReminder_IsSuppressedWhileTheRoutineHasAReminder_AndFiresAgainOnceItHasNone()
    {
        var time = new FakeTimeProvider(Now);
        var member = Member(1, 0);
        member.ReminderTime = Nine;
        member.NextReminderUtc = Now.UtcDateTime;

        await using var host = await CreateHostAsync(time, TomorrowNineBerlin.AddHours(1), member);

        await RunJobAsync(host);

        host.Discord.Messages.Should().BeEmpty();
        (await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits.Select(h => h.NextReminderUtc).SingleAsync()))
            .Should().Be(TomorrowNineBerlin);

        await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Routines
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.ReminderTime, (TimeOnly?)null).SetProperty(r => r.NextReminderUtc, (DateTime?)null)));
        time.SetUtcNow(TomorrowNineBerlin);

        await RunJobAsync(host);

        host.Discord.Messages.Should().ContainSingle().Which.Text.Should().Contain("Habit 1").And.Contain("Did you follow this habit today?");
    }
}
