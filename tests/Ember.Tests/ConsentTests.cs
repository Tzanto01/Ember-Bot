using Ember.Bot.Modules;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Integration")]
public class ConsentTests
{
    private static readonly DateTimeOffset Now = new(2027, 1, 15, 0, 0, 0, TimeSpan.Zero);

    private static async Task SeedExistingUserAsync(IntegrationTestHost host, long userId, string? policyVersion = null)
    {
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var user = new User
            {
                DiscordUserId = userId,
                Timezone = "Pacific/Auckland",
                HealthDataConsentAt = policyVersion is null ? null : new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                ConsentPolicyVersion = policyVersion,
            };
            user.Habits.Add(new Habit { Name = "Walk", CreatedAt = Now.UtcDateTime.AddDays(-30) });
            db.Users.Add(user);
            await db.SaveChangesAsync();
        });
    }

    private static Task<bool> ClaimAsync(IntegrationTestHost host, ulong userId)
        => host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().ClaimConsentPromptAsync(userId));

    [Fact]
    public async Task AddHabit_WithoutConsent_IsRefusedAndStoresNothing()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(Now));

        var add = () => host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().AddHabitAsync(1, "Take meds", null));

        await add.Should().ThrowAsync<ConsentRequiredException>();
        (await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users.CountAsync())).Should().Be(0);
    }

    [Fact]
    public async Task AgreeingByOwner_StoresTimestampAndPolicyVersion_AndUnlocksHabits()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(Now));

        var answered = await host.WithScopeAsync(sp =>
            ConsentModule.TryAnswerAsync(sp.GetRequiredService<HabitService>(), "1", clickerId: 1, agreed: true));
        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().AddHabitAsync(1, "Take meds", null));

        answered.Should().BeTrue();
        var user = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users.Include(u => u.Habits).SingleAsync());
        user.HealthDataConsentAt.Should().Be(Now.UtcDateTime);
        user.ConsentPolicyVersion.Should().Be(HabitService.CurrentConsentPolicyVersion);
        user.Habits.Should().ContainSingle();
    }

    [Fact]
    public async Task DecliningOrSomeoneElsesClick_StoresNothing()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(Now));

        var declined = await host.WithScopeAsync(sp =>
            ConsentModule.TryAnswerAsync(sp.GetRequiredService<HabitService>(), "1", clickerId: 1, agreed: false));
        var stranger = await host.WithScopeAsync(sp =>
            ConsentModule.TryAnswerAsync(sp.GetRequiredService<HabitService>(), "1", clickerId: 2, agreed: true));

        declined.Should().BeTrue();
        stranger.Should().BeFalse();
        (await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users.CountAsync())).Should().Be(0);
    }

    [Fact]
    public async Task ExistingUserWithoutConsent_IsPromptedOncePerLocalDay_AndNoLongerAfterAgreeing()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        await SeedExistingUserAsync(host, 1);

        (await ClaimAsync(host, 1)).Should().BeTrue();
        time.Advance(TimeSpan.FromHours(2));
        (await ClaimAsync(host, 1)).Should().BeFalse();

        time.Advance(TimeSpan.FromHours(12));
        (await ClaimAsync(host, 1)).Should().BeTrue("Auckland has reached the next local day");

        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GiveHealthDataConsentAsync(1));
        time.Advance(TimeSpan.FromDays(1));
        (await ClaimAsync(host, 1)).Should().BeFalse();
    }

    [Fact]
    public async Task ConsentForAnOlderPolicyVersion_DoesNotCount()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(Now));
        await SeedExistingUserAsync(host, 1, policyVersion: "2020-01");

        (await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().HasHealthDataConsentAsync(1))).Should().BeFalse();
        (await ClaimAsync(host, 1)).Should().BeTrue();
    }

    [Fact]
    public async Task ReleasingTodaysClaim_AfterTheFollowUpFailed_LetsTheNextInteractionAskAgain()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(Now));
        await SeedExistingUserAsync(host, 1);

        (await ClaimAsync(host, 1)).Should().BeTrue();
        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().ReleaseConsentPromptAsync(1));

        (await ClaimAsync(host, 1)).Should().BeTrue();
    }

    [Fact]
    public async Task UserWithoutHabits_IsNotPromptedAfterInteractions()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(Now));
        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().SetGraceDaysAsync(1, 2));

        (await ClaimAsync(host, 1)).Should().BeFalse();
    }
}
