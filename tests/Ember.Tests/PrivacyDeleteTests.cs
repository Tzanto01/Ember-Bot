using Ember.Bot.Data;
using Ember.Bot.Models;
using Ember.Bot.Modules;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Ember.Tests;

[Collection("Integration")]
public class PrivacyDeleteTests
{
    private static readonly DateOnly Day = new(2027, 1, 15);

    private static async Task<IntegrationTestHost> CreateHostWithTwoUsersAsync()
    {
        var host = await IntegrationTestHost.CreateAsync(start: false);
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            foreach (var userId in new long[] { 1, 2 })
            {
                var user = new User { DiscordUserId = userId, Timezone = "Europe/Berlin" };
                for (var i = 0; i < 2; i++)
                {
                    var habit = new Habit { Name = $"Habit {userId}-{i}", ReminderTime = new TimeOnly(9, 0), NextReminderUtc = DateTime.UtcNow };
                    habit.Logs.Add(new HabitLog { Date = Day, Completed = true });
                    habit.Logs.Add(new HabitLog { Date = Day.AddDays(-1), Completed = false });
                    user.Habits.Add(habit);
                }
                db.Users.Add(user);
            }
            await db.SaveChangesAsync();
        });
        return host;
    }

    private static Task<(int Users, int Habits, int Logs)> CountsForAsync(IntegrationTestHost host, long userId)
        => host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            return (await db.Users.CountAsync(u => u.DiscordUserId == userId),
                    await db.Habits.CountAsync(h => h.UserId == userId),
                    await db.HabitLogs.CountAsync(l => l.Habit.UserId == userId));
        });

    [Fact]
    public async Task ConfirmByOwner_DeletesTheUserWithAllHabitsAndLogs_AndLeavesOthersUntouched()
    {
        await using var host = await CreateHostWithTwoUsersAsync();

        var deleted = await host.WithScopeAsync(sp =>
            PrivacyModule.TryDeleteAsync(sp.GetRequiredService<HabitService>(), "1", clickerId: 1));

        deleted.Should().BeTrue();
        (await CountsForAsync(host, 1)).Should().Be((0, 0, 0));
        (await CountsForAsync(host, 2)).Should().Be((1, 2, 4));
        var orphanLogs = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().HabitLogs.CountAsync());
        orphanLogs.Should().Be(4);
    }

    [Fact]
    public async Task ConfirmByAnotherUser_DeletesNothing()
    {
        await using var host = await CreateHostWithTwoUsersAsync();

        var deleted = await host.WithScopeAsync(sp =>
            PrivacyModule.TryDeleteAsync(sp.GetRequiredService<HabitService>(), "1", clickerId: 2));

        deleted.Should().BeFalse();
        (await CountsForAsync(host, 1)).Should().Be((1, 2, 4));
        (await CountsForAsync(host, 2)).Should().Be((1, 2, 4));
    }
}
