using Ember.Bot.Jobs;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;
using Quartz;

namespace Ember.Tests;

[Collection("Integration")]
public class LocalDayTests
{
    private const string LosAngeles = "America/Los_Angeles"; // UTC-8 in January
    private const string Brisbane   = "Australia/Brisbane";  // UTC+10, no DST

    private static async Task<int> SeedHabitAsync(IntegrationTestHost host, long userId, string timezone)
    {
        return await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Users.Add(new User { Id = TestUsers.Id(userId), Logins = TestUsers.Discord(userId), Timezone = timezone });
            var habit = new Habit { UserId = TestUsers.Id(userId), Name = "Stretch", CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) };
            db.Habits.Add(habit);
            await db.SaveChangesAsync();
            return habit.Id;
        });
    }

    private static Task<DateOnly> CheckInAtAsync(IntegrationTestHost host, FakeTimeProvider time, DateTimeOffset utcNow, long userId, int habitId)
    {
        time.SetUtcNow(utcNow);
        return host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var today = await service.GetLocalTodayAsync((ulong)userId);
            (await service.CheckInAsync((ulong)userId, habitId, today, completed: true)).Should().Be(DayEditResult.Saved);
            return await sp.GetRequiredService<EmberDbContext>().HabitLogs
                .Where(l => l.HabitId == habitId).OrderByDescending(l => l.Id).Select(l => l.Date).FirstAsync();
        });
    }

    [Fact]
    public async Task CheckIn_LateEveningAtUtcMinus8_LandsOnLocalDate()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 1, 10, 0, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(time: time);
        var habitId = await SeedHabitAsync(host, 501, LosAngeles);

        // 22:30 on Jan 14 in Los Angeles is already 06:30 on Jan 15 in UTC.
        var date = await CheckInAtAsync(host, time, new DateTimeOffset(2026, 1, 15, 6, 30, 0, TimeSpan.Zero), 501, habitId);

        date.Should().Be(new DateOnly(2026, 1, 14));
    }

    [Fact]
    public async Task CheckIn_AtUtcPlus10_LateEveningAndEarlyMorning_LandOnLocalDates()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 1, 10, 0, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(time: time);
        var habitId = await SeedHabitAsync(host, 502, Brisbane);

        // 23:30 local on Jan 14 = 13:30 UTC Jan 14; 07:00 local on Jan 15 = 21:00 UTC Jan 14.
        var evening = await CheckInAtAsync(host, time, new DateTimeOffset(2026, 1, 14, 13, 30, 0, TimeSpan.Zero), 502, habitId);
        var morning = await CheckInAtAsync(host, time, new DateTimeOffset(2026, 1, 14, 21, 0, 0, TimeSpan.Zero), 502, habitId);

        evening.Should().Be(new DateOnly(2026, 1, 14));
        morning.Should().Be(new DateOnly(2026, 1, 15));
    }

    [Fact]
    public async Task CheckIns_OnConsecutiveLocalDays_WithinOneUtcDay_KeepBothDaysAndTheStreak()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 1, 10, 0, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(time: time);
        var habitId = await SeedHabitAsync(host, 503, LosAngeles);

        // 21:00 local Jan 13 and 15:00 local Jan 14 both fall on Jan 14 in UTC.
        await CheckInAtAsync(host, time, new DateTimeOffset(2026, 1, 14, 5, 0, 0, TimeSpan.Zero), 503, habitId);
        await CheckInAtAsync(host, time, new DateTimeOffset(2026, 1, 14, 23, 0, 0, TimeSpan.Zero), 503, habitId);

        var habit = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GetHabitAsync(503, habitId));
        habit!.Logs.Select(l => l.Date).Should().BeEquivalentTo([new DateOnly(2026, 1, 13), new DateOnly(2026, 1, 14)]);
        HabitService.ConsecutiveStreak(habit, new DateOnly(2026, 1, 14), graceDays: 0).streak.Should().Be(2);
    }

    [Fact]
    public async Task WeeklySummaryJob_SendsOnlyToUsersWhoseLocalTimeIsSundayMorning()
    {
        // Sunday Jan 18 2026, 17:00 UTC = Sunday 09:00 in Los Angeles, Monday 03:00 in Brisbane.
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 1, 18, 17, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(time: time);

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var created = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

            var notDue = new User { Id = TestUsers.Id(601), Logins = TestUsers.Discord(601), Timezone = Brisbane };
            notDue.Habits.Add(new Habit { UserId = TestUsers.Id(601), Name = "Walk", CreatedAt = created });

            var due = new User { Id = TestUsers.Id(602), Logins = TestUsers.Discord(602), Timezone = LosAngeles };
            var habit = new Habit { UserId = TestUsers.Id(602), Name = "Read", CreatedAt = created };
            habit.Logs.Add(new HabitLog { Date = new DateOnly(2026, 1, 17), Completed = true });
            due.Habits.Add(habit);

            db.Users.AddRange(notDue, due);
            await db.SaveChangesAsync();
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(WeeklySummaryJob.Key);
        await host.WaitForDmCountAsync(1);

        var message = host.Discord.Messages.Should().ContainSingle().Subject;
        message.UserId.Should().Be(602);
        message.Embed!.Fields.Single().Value.Should().StartWith("⬜⬜⬜⬜⬜⬜✅");
    }
}
