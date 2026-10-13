using Ember.Bot.Data;
using Ember.Bot.Models;
using Ember.Bot.Modules;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Integration")]
public class ReflectionInviteTests
{
    private const ulong UserId = 1601;

    [Fact]
    public async Task OpenHabits_ListsOnlyDailyHabitsStillToLogForThatDay()
    {
        var now = new DateTimeOffset(2026, 1, 14, 10, 0, 0, TimeSpan.Zero);
        var yesterday = new DateOnly(2026, 1, 13);
        var created = now.UtcDateTime.AddDays(-5);
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(now));
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var user = new User { DiscordUserId = (long)UserId, Timezone = "UTC" };
            var done = new Habit { Name = "Read", CreatedAt = created };
            done.Logs.Add(new HabitLog { Date = yesterday, Completed = true });
            var skipped = new Habit { Name = "Walk", CreatedAt = created.AddMinutes(1) };
            skipped.Logs.Add(new HabitLog { Date = yesterday, Completed = false });
            user.Habits.Add(new Habit { Name = "Stretch", CreatedAt = created.AddMinutes(2) });
            user.Habits.Add(done);
            user.Habits.Add(skipped);
            user.Habits.Add(new Habit { Name = "Nap", CreatedAt = created, PausedUntil = yesterday });
            user.Habits.Add(new Habit { Name = "Swim", CreatedAt = created, FrequencyType = FrequencyType.Weekly, WeeklyTarget = 2 });
            user.Habits.Add(new Habit { Name = "Journal", CreatedAt = now.UtcDateTime.AddDays(-1) });
            db.Users.Add(user);
            await db.SaveChangesAsync();
        });

        var open = await host.WithScopeAsync(sp =>
            ReflectDismissModule.OpenHabitsAsync(sp.GetRequiredService<HabitService>(), UserId, yesterday));

        open.Select(h => h.Name).Should().Equal("Walk", "Stretch");
    }
}
