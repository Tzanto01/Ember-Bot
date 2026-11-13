using Ember.Bot.Jobs;
using Ember.Bot.Modules;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

/// <summary>Several reminder times per habit (contract "Reminder times v1.12").</summary>
[Collection("Integration")]
public class ReminderTimesTests
{
    private const long DiscordUser = 10;
    private static readonly TimeZoneInfo BerlinTz = TimezoneHelper.Find("Europe/Berlin")!;

    // Friday 2027-01-15, 08:00 in Berlin (UTC+1).
    private static readonly DateTimeOffset Now = new(2027, 1, 15, 7, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly Today = new(2027, 1, 15);

    private static DateTime Utc(int month, int day, int hour, int minute = 0) => new(2027, month, day, hour, minute, 0, DateTimeKind.Utc);

    private static List<TimeOnly> At(params string[] times) => times.Select(t => TimeOnly.Parse(t)).ToList();

    [Fact]
    public void NextOccurrence_IsTheNextOfAnyTime_InTheUsersTimezone()
    {
        var times = At("20:00", "08:00", "13:00");

        TimezoneHelper.NextOccurrenceUtc(times, BerlinTz, Utc(1, 15, 9)).Should().Be(Utc(1, 15, 12));
        TimezoneHelper.NextOccurrenceUtc(times, BerlinTz, Utc(1, 15, 12)).Should().Be(Utc(1, 15, 19), "a time that is due now is not next");
        TimezoneHelper.NextOccurrenceUtc(times, BerlinTz, Utc(1, 15, 6, 59)).Should().Be(Utc(1, 15, 7));
        TimezoneHelper.NextOccurrenceUtc(At(), BerlinTz, Utc(1, 15, 9)).Should().BeNull();
    }

    [Fact]
    public void NextOccurrence_CrossesMidnight_AndDaylightSavingInTheUsersTimezone()
    {
        TimezoneHelper.NextOccurrenceUtc(At("07:00", "23:30"), BerlinTz, Utc(1, 15, 22, 45)).Should().Be(Utc(1, 16, 6));

        var springForward = At("02:30", "22:00");
        TimezoneHelper.NextOccurrenceUtc(springForward, BerlinTz, Utc(3, 27, 22)).Should().Be(Utc(3, 28, 1),
            "02:30 doesn't exist on 2027-03-28 in Berlin and moves to 03:00 CEST");
        TimezoneHelper.NextOccurrenceUtc(springForward, BerlinTz, Utc(3, 28, 1)).Should().Be(Utc(3, 28, 20), "22:00 CEST is 20:00 UTC");
    }

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

    private static Habit Habit(int id, List<TimeOnly> times, int timesPerDay = 1) => new()
    {
        Id = id,
        UserId = TestUsers.Id(DiscordUser),
        Name = $"Habit {id}",
        ReminderTimes = times,
        TimesPerDay = timesPerDay,
        NextReminderUtc = Now.UtcDateTime,
        CreatedAt = Now.UtcDateTime.AddDays(-30),
    };

    private static Task RunJobAsync(IntegrationTestHost host)
        => ActivatorUtilities.CreateInstance<ReminderDispatchJob>(host.Host.Services).RunAsync();

    private static async Task<(DateTime? Next, DateTime? Second)> RemindersAsync(IntegrationTestHost host, int habitId)
    {
        var r = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits
            .Where(h => h.Id == habitId).Select(h => new { h.NextReminderUtc, h.SecondReminderUtc }).SingleAsync());
        return (r.NextReminderUtc, r.SecondReminderUtc);
    }

    private static Task CheckInAsync(IntegrationTestHost host, int habitId)
        => host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().AddCheckInAsync(TestUsers.Id(DiscordUser), habitId, Today));

    [Fact]
    public async Task A_three_times_habit_sends_at_each_time_while_open_and_stops_once_the_day_reaches_three()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, 0, Habit(1, At("08:00", "13:00", "20:00"), timesPerDay: 3));

        await RunJobAsync(host);
        host.Discord.Messages.Should().ContainSingle();
        (await RemindersAsync(host, 1)).Next.Should().Be(Utc(1, 15, 12));
        await CheckInAsync(host, 1);

        time.SetUtcNow(Utc(1, 15, 12));
        await RunJobAsync(host);
        host.Discord.Messages.Should().HaveCount(2);
        (await RemindersAsync(host, 1)).Next.Should().Be(Utc(1, 15, 19));
        await CheckInAsync(host, 1);
        await CheckInAsync(host, 1);

        time.SetUtcNow(Utc(1, 15, 19));
        await RunJobAsync(host);
        host.Discord.Messages.Should().HaveCount(2, "the day reached 3 of 3");
        (await RemindersAsync(host, 1)).Next.Should().Be(Utc(1, 16, 7));
    }

    [Fact]
    public async Task The_second_reminder_is_skipped_when_the_next_regular_reminder_comes_first_or_at_the_same_time()
    {
        await using var host = await CreateHostAsync(new FakeTimeProvider(Now), 30,
            Habit(1, At("08:00", "08:15"), timesPerDay: 2),
            Habit(2, At("08:00", "08:30"), timesPerDay: 2),
            Habit(3, At("08:00", "13:00"), timesPerDay: 2));

        await RunJobAsync(host);

        host.Discord.Messages.Should().HaveCount(3);
        (await RemindersAsync(host, 1)).Should().Be(((DateTime?)Utc(1, 15, 7, 15), (DateTime?)null));
        (await RemindersAsync(host, 2)).Should().Be(((DateTime?)Utc(1, 15, 7, 30), (DateTime?)null));
        (await RemindersAsync(host, 3)).Should().Be(((DateTime?)Utc(1, 15, 12), (DateTime?)Utc(1, 15, 7, 30)));
    }

    [Fact]
    public void Discord_lists_all_times_and_names_the_times_a_single_time_replaced()
    {
        HabitModule.FormatReminder(Ember.Bot.BotTexts.English, At("08:00", "13:00", "20:00")).Should().Be("Reminders: 08:00, 13:00, 20:00 your time");
        HabitModule.FormatReminder(Ember.Bot.BotTexts.English, At("09:05")).Should().Be("Reminder: 09:05 your time");
        HabitModule.FormatReminder(Ember.Bot.BotTexts.English, At()).Should().Be("Reminder: None set");

        ReminderSetupModule.ReplacedText(Ember.Bot.BotTexts.English, At("08:00", "20:00")).Should().Contain("replaces your earlier reminders at 08:00, 20:00");
        ReminderSetupModule.ReplacedText(Ember.Bot.BotTexts.English, At("08:00")).Should().BeEmpty();
    }

    [Fact]
    public void Export_lists_all_reminder_times()
    {
        var user = new User { Id = TestUsers.Id(DiscordUser), Timezone = "Europe/Berlin" };
        var habit = HabitFactory.Make();
        habit.Id = 3;
        habit.Name = "Water";
        habit.TimesPerDay = 2;
        habit.ReminderTimes = At("08:00", "20:00");
        user.Habits.Add(habit);

        ExportBuilder.BuildDocument(user).Habits.Should().ContainSingle()
            .Which.Should().Match<ExportBuilder.HabitRecord>(h => h.ReminderTime == new TimeOnly(8, 0) && h.ReminderTimes.SequenceEqual(habit.ReminderTimes));
        ExportBuilder.BuildCsv(user).Should().Contain(",Water,daily,,08:00;20:00,");
    }
}
