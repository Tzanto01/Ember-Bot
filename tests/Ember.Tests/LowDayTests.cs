using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

public class LowDayTests
{
    private static readonly DateOnly Today = HabitFactory.Today;

    private static HashSet<DateOnly> LowDays(params int[] daysAgo) => daysAgo.Select(d => Today.AddDays(-d)).ToHashSet();

    [Fact]
    public void LowDay_InsideAStreak_NeitherBreaksNorExtendsIt()
    {
        var habit = HabitFactory.Make((0, true), (1, true), (3, true), (4, true));

        HabitService.ConsecutiveStreak(habit, Today, graceDays: 0, LowDays(2)).Should().Be((4, 0));
    }

    [Fact]
    public void LowDay_WithACheckIn_DoesNotExtendTheStreak()
    {
        var habit = HabitFactory.Make((0, true), (1, true), (2, true), (3, true), (4, true));

        HabitService.ConsecutiveStreak(habit, Today, graceDays: 0, LowDays(2)).streak.Should().Be(4);
    }

    [Fact]
    public void LowDay_InsideAGraceWindow_SavesTheGraceDayForAnotherGap()
    {
        // Closed gaps 2 and 4 days ago; one grace day per week covers only one of them, the low day covers the other.
        var habit = HabitFactory.Make((0, true), (1, true), (3, true), (5, true), (6, true));

        HabitService.ConsecutiveStreak(habit, Today, graceDays: 1).streak.Should().Be(3);
        HabitService.ConsecutiveStreak(habit, Today, graceDays: 1, LowDays(4)).Should().Be((5, 1));
    }

    [Fact]
    public void LowDay_BeforeTheLocalStartDay_IsNotCountedForTheLastSevenDays()
    {
        // Created 23:30 UTC three days ago: still that day in UTC, already the next day in Tokyo.
        var habit = HabitFactory.Make();
        habit.CreatedAt = Today.AddDays(-3).ToDateTime(new TimeOnly(23, 30), DateTimeKind.Utc);
        var tokyo = TimeZoneInfo.FindSystemTimeZoneById("Asia/Tokyo");

        HabitService.FlexibleStreak(habit, Today, 7, LowDays(3)).Should().Be(1);
        HabitService.FlexibleStreak(habit, Today, 7, LowDays(3), tokyo).Should().Be(0);
    }

    [Fact]
    public void LowDay_CountsAsKeptForTheLastSevenDays_OncePerDay()
    {
        var habit = HabitFactory.Make((0, true), (1, true), (2, false));

        HabitService.FlexibleStreak(habit, Today, 7, LowDays(1, 2, 3, 8)).Should().Be(4);
    }

    [Fact]
    public void LowDays_BeforeTheHabitStartedOrWhilePaused_AreNotCountedAsKept()
    {
        var habit = HabitFactory.Make(createdAtDaysAgo: 2, pausedUntilDaysAgo: null, FrequencyType.Daily, weeklyTarget: null);
        var paused = HabitFactory.Make((0, true));
        paused.PausedFrom = Today.AddDays(-4);
        paused.PausedUntil = Today.AddDays(-3);

        HabitService.FlexibleStreak(habit, Today, 7, LowDays(2, 3, 4, 5)).Should().Be(1);
        HabitService.FlexibleStreak(paused, Today, 7, LowDays(3, 4, 5)).Should().Be(2);
    }

    [Fact]
    public void WeeklySummary_DoesNotCountALowDayAgainstTheWeek()
    {
        var habit = HabitFactory.Make((1, true), (2, true), (3, true), (4, true), (5, true));
        var user = new User { Timezone = "UTC", GraceDaysPerWeek = 0, Habits = { habit } };
        user.DayMarks.Add(new DayMark { Date = Today.AddDays(-6), Kind = DayMarkKind.LowDay });

        var summary = WeeklySummaryService.Build(user, Today.AddDays(-1));

        summary.Habits.Single().Should().Match<WeeklySummaryService.HabitSummary>(h => h.Done == 5 && h.Possible == 6);
    }
}

[Collection("Integration")]
public class LowDayServiceTests
{
    private const ulong UserId = 950;
    private static readonly DateTimeOffset Now = new(2027, 1, 15, 12, 0, 0, TimeSpan.Zero);

    private static Task<List<DateOnly>> StoredLowDaysAsync(IntegrationTestHost host)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().DayMarks
            .Where(m => m.UserId == (long)UserId && m.Kind == DayMarkKind.LowDay).OrderBy(m => m.Date).Select(m => m.Date).ToListAsync());

    [Fact]
    public async Task LowDays_CanBeSetForTodayAndPastDays_OnlyOnce_AndRemovedAgain_ButNotForTheFuture()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(Now));
        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GiveHealthDataConsentAsync(UserId));
        var today = new DateOnly(2027, 1, 15);

        var results = await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            return new[]
            {
                await service.SetLowDayAsync(UserId, today),
                await service.SetLowDayAsync(UserId, today.AddDays(-30)),
                await service.SetLowDayAsync(UserId, today),
                await service.SetLowDayAsync(UserId, today.AddDays(1)),
            };
        });

        results.Should().Equal(DayEditResult.Saved, DayEditResult.Saved, DayEditResult.Saved, DayEditResult.InFuture);
        (await StoredLowDaysAsync(host)).Should().Equal(today.AddDays(-30), today);
        (await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().GetLowDaysAsync(UserId)))
            .Should().BeEquivalentTo([today.AddDays(-30), today]);

        await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().ClearLowDayAsync(UserId, today));
        (await StoredLowDaysAsync(host)).Should().Equal(today.AddDays(-30));
    }

    [Fact]
    public async Task LowDay_WithoutConsent_IsRefusedAndStoresNothing()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(Now));

        var result = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().SetLowDayAsync(UserId, new DateOnly(2027, 1, 15)));

        result.Should().Be(DayEditResult.ConsentRequired);
        (await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users.CountAsync())).Should().Be(0);
    }

    [Fact]
    public async Task DeletingMyData_AlsoRemovesLowDays()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: new FakeTimeProvider(Now));
        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.GiveHealthDataConsentAsync(UserId);
            await service.SetLowDayAsync(UserId, new DateOnly(2027, 1, 14));
            await service.DeleteUserDataAsync(UserId);
        });

        (await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().DayMarks.CountAsync())).Should().Be(0);
    }
}
