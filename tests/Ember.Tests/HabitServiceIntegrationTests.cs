using Ember.Bot.Modules;
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
public class HabitServiceIntegrationTests
{
    [Fact]
    public async Task AddHabitAsync_CreatesUserHabitAndSchedule()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        var habitId = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.GiveHealthDataConsentAsync(123);
            var habit = await service.AddHabitAsync(123, "Drink Water", new TimeOnly(9, 0));
            return habit.Id;
        });

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var user = await db.Users.FindAsync(await TestUsers.UserIdAsync(sp, 123));
            var habit = await db.Habits.FindAsync(habitId);

            user.Should().NotBeNull();
            habit.Should().NotBeNull();
            habit!.Name.Should().Be("Drink Water");
            habit.ReminderTime.Should().Be(new TimeOnly(9, 0));
            habit.NextReminderUtc.Should().NotBeNull();
        });
    }

    [Fact]
    public async Task EditHabitAsync_ClearingReminderClearsNextReminder()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        var habitId = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.GiveHealthDataConsentAsync(123);
            var habit = await service.AddHabitAsync(123, "Journal", new TimeOnly(21, 30));
            await service.EditHabitAsync(123, habit.Id, null, null, clearReminder: true);
            return habit.Id;
        });

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var habit = await db.Habits.FindAsync(habitId);
            habit.Should().NotBeNull();
            habit!.ReminderTime.Should().BeNull();
            habit.NextReminderUtc.Should().BeNull();
        });
    }

    [Fact]
    public async Task PresetReminder_SetsTheTimeOnlyForTheClickingUsersOwnHabit()
    {
        var now = new DateTimeOffset(2027, 1, 15, 6, 0, 0, TimeSpan.Zero);
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(now));

        var habitId = await host.WithScopeAsync(async sp =>
        {
            await sp.GetRequiredService<HabitService>().GiveHealthDataConsentAsync(123);
            return (await sp.GetRequiredService<HabitService>().AddHabitAsync(123, "Journal", null)).Id;
        });

        var byStranger = await host.WithScopeAsync(sp =>
            ReminderSetupModule.SetPresetReminderAsync(sp.GetRequiredService<HabitService>(), 456, habitId.ToString(), "07:30"));
        var malformed = await host.WithScopeAsync(sp =>
            ReminderSetupModule.SetPresetReminderAsync(sp.GetRequiredService<HabitService>(), 123, habitId.ToString(), "7h30"));

        byStranger.Should().BeNull();
        malformed.Should().BeNull();
        (await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits.FindAsync(habitId).AsTask()))!
            .ReminderTime.Should().BeNull();

        var byOwner = await host.WithScopeAsync(sp =>
            ReminderSetupModule.SetPresetReminderAsync(sp.GetRequiredService<HabitService>(), 123, habitId.ToString(), "07:30"));

        byOwner!.ReminderTime.Should().Be(new TimeOnly(7, 30));
        byOwner.NextReminderUtc.Should().Be(new DateTime(2027, 1, 15, 7, 30, 0, DateTimeKind.Utc));
    }

    [Fact]
    public async Task CheckInAsync_UpsertsTodaysLogAndUpdatesGuild()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var db = sp.GetRequiredService<EmberDbContext>();

            await service.GiveHealthDataConsentAsync(456);
            var habit = await service.AddHabitAsync(456, "Read", reminderTime: null);
            var today = await service.GetLocalTodayAsync(456);
            await service.CheckInAsync(456, habit.Id, today, completed: true, guildId: 100);
            await service.CheckInAsync(456, habit.Id, today, completed: false, guildId: 200);

            var logs = db.HabitLogs.Where(l => l.HabitId == habit.Id).ToList();
            logs.Should().HaveCount(1);
            logs[0].Completed.Should().BeFalse();
            logs[0].GuildId.Should().Be(200);
        });
    }

    [Fact]
    public async Task AddHabitAsync_BeyondThePerUserLimit_IsRefusedAndNothingIsAdded()
    {
        await using var host = await IntegrationTestHost.CreateAsync();

        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            var db = sp.GetRequiredService<EmberDbContext>();

            await service.GiveHealthDataConsentAsync(789);
            for (var i = 1; i <= HabitService.MaxHabitsPerUser; i++)
                await service.AddHabitAsync(789, $"Habit {i}", reminderTime: null);

            var add51st = () => service.AddHabitAsync(789, "One more", reminderTime: null, FrequencyType.Weekly, 2);

            await add51st.Should().ThrowAsync<HabitLimitReachedException>();
            var userId = await TestUsers.UserIdAsync(sp, 789);
            db.Habits.Count(h => h.UserId == userId).Should().Be(HabitService.MaxHabitsPerUser);
        });
    }
}
