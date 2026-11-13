using Discord;
using Ember.Bot.Modules;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Integration")]
public class StreakStatsTests
{
    private const ulong UserId = 4343;

    private static ButtonComponent Button(MessageComponent components) =>
        components.Components.OfType<ActionRowComponent>().SelectMany(r => r.Components).OfType<ButtonComponent>().Single();

    [Fact]
    public async Task StreakReply_StartsWithoutStreaks_AndItsButtonTurnsThemOnAndOffAgain()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2027, 1, 10, 12, 0, 0, TimeSpan.Zero));
        await using var host = await IntegrationTestHost.CreateAsync(start: false, time: time);
        await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            await service.GiveHealthDataConsentAsync(UserId);
            var habit = await service.AddHabitAsync(UserId, "Stretch", null);
            await service.CheckInAsync(UserId, habit.Id, new DateOnly(2027, 1, 10), completed: true, guildId: null);
        });

        async Task<(Embed Page, ButtonComponent Button, bool Stored)> ClickAsync(string? customId) => await host.WithScopeAsync(async sp =>
        {
            var service = sp.GetRequiredService<HabitService>();
            if (customId is not null) await service.SetShowStreaksAsync(UserId, customId == "habit:streaks:on");
            var (pages, toggle) = await HabitModule.RenderStatsAsync(Ember.Bot.BotTexts.English, service, UserId);
            return (pages.Single(), Button(toggle), await service.GetShowStreaksAsync(UserId));
        });

        var off = await ClickAsync(null);
        off.Stored.Should().BeFalse();
        off.Button.Label.Should().Be("Show streaks");
        off.Page.Fields.Single().Value.Should().Be("Last 7: **1/7** · Last 30: **1/30**\nTotal: **1**");
        off.Page.Footer!.Value.Text.Should().NotContain("Flex");

        var on = await ClickAsync(off.Button.CustomId);
        on.Stored.Should().BeTrue();
        on.Button.Label.Should().Be("Hide streaks");
        on.Page.Fields.Single().Value.Should().Be("Streak: **1** day\nLast 7: **1/7** · Last 30: **1/30**\nBest: **1** · Total: **1**");

        var offAgain = await ClickAsync(on.Button.CustomId);
        offAgain.Stored.Should().BeFalse();
        offAgain.Page.Fields.Single().Value.Should().NotContain("Streak").And.NotContain("Best");
    }
}
