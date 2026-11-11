using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Integration")]
public class UnconfirmedAccountCleanupTests
{
    private static readonly DateTimeOffset Now = new(2027, 3, 10, 3, 30, 0, TimeSpan.Zero);

    private static User Signup(int daysOld, bool confirmed = false) => new()
    {
        Id = Guid.CreateVersion7(Now.AddDays(-daysOld)),
        UserName = $"user{daysOld}{confirmed}@example.test",
        Email = $"user{daysOld}{confirmed}@example.test",
        PasswordHash = "synthetic-hash",
        EmailConfirmed = confirmed,
    };

    private static async Task<bool> SurvivesCleanupAsync(User user)
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(Now));
        return await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Users.Add(user);
            await db.SaveChangesAsync();

            await sp.GetRequiredService<HabitService>().DeleteStaleUnconfirmedAccountsAsync();

            return await db.Users.AnyAsync(u => u.Id == user.Id);
        });
    }

    [Fact]
    public async Task An_unconfirmed_signup_older_than_seven_days_is_deleted()
        => (await SurvivesCleanupAsync(Signup(daysOld: 8))).Should().BeFalse();

    [Fact]
    public async Task An_unconfirmed_signup_younger_than_seven_days_is_kept()
        => (await SurvivesCleanupAsync(Signup(daysOld: 6))).Should().BeTrue();

    [Fact]
    public async Task A_confirmed_account_is_kept()
        => (await SurvivesCleanupAsync(Signup(daysOld: 8, confirmed: true))).Should().BeTrue();

    [Fact]
    public async Task An_unconfirmed_account_with_a_Discord_login_is_kept()
    {
        var user = Signup(daysOld: 8);
        user.Logins.Add(new() { LoginProvider = DiscordLogin.Provider, ProviderKey = DiscordLogin.Key(77), ProviderDisplayName = DiscordLogin.Provider, UserId = user.Id });

        (await SurvivesCleanupAsync(user)).Should().BeTrue();
    }

    [Fact]
    public async Task An_unconfirmed_account_with_a_habit_is_kept()
    {
        var user = Signup(daysOld: 8);
        user.Habits.Add(new Habit { Name = "Stretch", CreatedAt = Now.UtcDateTime.AddDays(-8) });

        (await SurvivesCleanupAsync(user)).Should().BeTrue();
    }
}
