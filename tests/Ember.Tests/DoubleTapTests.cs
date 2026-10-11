using System.Data.Common;
using Ember.Bot.Data;
using Ember.Bot.Models;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

/// <summary>
/// A double tap (or two devices) can make two requests both see "no row yet" and both
/// insert. These tests let a competing request insert the row right before our save.
/// </summary>
[Collection("Integration")]
public class DoubleTapTests
{
    private sealed class RaceInterceptor : SaveChangesInterceptor
    {
        public Func<DbConnection, Task>? Competitor { get; set; }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            var competitor = Competitor;
            Competitor = null;
            if (competitor is not null)
                await competitor(eventData.Context!.Database.GetDbConnection());
            return result;
        }
    }

    private static async Task InsertFromOtherRequestAsync(DbConnection connection, Action<EmberDbContext> add)
    {
        var options = new DbContextOptionsBuilder<EmberDbContext>().UseSqlite(connection).Options;
        await using var other = new EmberDbContext(options);
        add(other);
        await other.SaveChangesAsync();
    }

    [Fact]
    public async Task EnsureUser_WhenAnotherRequestInsertedTheUserFirst_DoesNotThrowAndKeepsOneRow()
    {
        var race = new RaceInterceptor();
        await using var host = await IntegrationTestHost.CreateAsync(configureDb: o => o.AddInterceptors(race));

        race.Competitor = c => InsertFromOtherRequestAsync(c, db => db.Users.Add(new User { DiscordUserId = 700 }));

        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().EnsureUserAsync(700));

        var count = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users.CountAsync(u => u.DiscordUserId == 700));
        count.Should().Be(1);
    }

    [Fact]
    public async Task CheckIn_WhenAnotherRequestLoggedTheSameDayFirst_UpdatesThatRowInsteadOfThrowing()
    {
        var race = new RaceInterceptor();
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 1, 14, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(time: time, configureDb: o => o.AddInterceptors(race));

        var habitId = await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var habit = new Habit { User = new User { DiscordUserId = 701 }, Name = "Stretch", CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) };
            db.Habits.Add(habit);
            await db.SaveChangesAsync();
            return habit.Id;
        });

        race.Competitor = c => InsertFromOtherRequestAsync(c, db =>
            db.HabitLogs.Add(new HabitLog { HabitId = habitId, Date = new DateOnly(2026, 1, 14), Completed = false }));

        var log = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().CheckInAsync(701, habitId, completed: true));

        log.Should().NotBeNull();
        var logs = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().HabitLogs.Where(l => l.HabitId == habitId).ToListAsync());
        logs.Should().ContainSingle().Which.Completed.Should().BeTrue();
    }
}
