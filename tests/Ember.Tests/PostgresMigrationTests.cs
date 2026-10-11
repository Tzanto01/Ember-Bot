using Ember.Bot;
using Ember.Bot.Data;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Ember.Tests;

[Collection("Postgres")]
public class PostgresMigrationTests(PostgresFixture postgres)
{
    [DockerFact]
    public async Task InitializeAsync_AppliesAllMigrationsAndMatchesModel()
    {
        var connectionString = await postgres.CreateDatabaseAsync();
        using var host = AppHost.CreateHostBuilder([], new EmberHostOptions
        {
            IncludeDiscordGateway = false,
            ConfigureDbContext = (options, _) => options.UseNpgsql(connectionString)
        }).Build();

        await AppHost.InitializeAsync(host);

        int habitId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();
            (await db.Database.GetPendingMigrationsAsync()).Should().BeEmpty();
            db.Database.HasPendingModelChanges().Should().BeFalse();

            var service = scope.ServiceProvider.GetRequiredService<HabitService>();
            var habit = await service.AddHabitAsync(4242, "Stretch", new TimeOnly(7, 30));
            habitId = habit.Id;
            (await service.CheckInAsync(4242, habitId, completed: true, guildId: 99)).Should().NotBeNull();
        }

        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();
            var stored = await db.Habits.Include(h => h.User).Include(h => h.Logs).SingleAsync(h => h.Id == habitId);

            stored.User.DiscordUserId.Should().Be(4242);
            stored.Name.Should().Be("Stretch");
            stored.ReminderTime.Should().Be(new TimeOnly(7, 30));
            stored.Logs.Should().ContainSingle(l => l.Completed && l.GuildId == 99);
        }
    }
}
