using Ember.Bot.Services;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

public class FeedbackCooldownTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void A_user_may_send_five_per_hour_and_is_refused_after_that()
    {
        var cooldown = new FeedbackCooldown(new FakeTimeProvider(Start));

        for (var i = 0; i < 5; i++) cooldown.TryRecord(1).Should().BeTrue();

        cooldown.CanSend(1).Should().BeFalse();
        cooldown.TryRecord(1).Should().BeFalse();
    }

    [Fact]
    public void Other_users_are_unaffected_by_a_users_limit()
    {
        var cooldown = new FeedbackCooldown(new FakeTimeProvider(Start));
        for (var i = 0; i < 5; i++) cooldown.TryRecord(1);

        cooldown.CanSend(2).Should().BeTrue();
        cooldown.TryRecord(2).Should().BeTrue();
    }

    [Fact]
    public void Checking_does_not_count_toward_the_limit()
    {
        var cooldown = new FeedbackCooldown(new FakeTimeProvider(Start));

        for (var i = 0; i < 20; i++) cooldown.CanSend(1).Should().BeTrue();

        for (var i = 0; i < 5; i++) cooldown.TryRecord(1).Should().BeTrue();
    }

    [Fact]
    public void The_user_may_send_again_once_the_hour_has_passed()
    {
        var time = new FakeTimeProvider(Start);
        var cooldown = new FeedbackCooldown(time);
        for (var i = 0; i < 5; i++) cooldown.TryRecord(1);

        time.Advance(TimeSpan.FromMinutes(59));
        cooldown.CanSend(1).Should().BeFalse();
        time.Advance(TimeSpan.FromMinutes(1));

        cooldown.CanSend(1).Should().BeTrue();
        cooldown.TryRecord(1).Should().BeTrue();
    }

    [Fact]
    public void The_window_slides_so_only_expired_submissions_free_a_slot()
    {
        var time = new FakeTimeProvider(Start);
        var cooldown = new FeedbackCooldown(time);
        cooldown.TryRecord(1);
        time.Advance(TimeSpan.FromMinutes(30));
        for (var i = 0; i < 4; i++) cooldown.TryRecord(1);

        time.Advance(TimeSpan.FromMinutes(30));

        cooldown.TryRecord(1).Should().BeTrue();
        cooldown.TryRecord(1).Should().BeFalse();
    }
}

public class FeedbackTextValidationTests
{
    [Theory]
    [InlineData("")]
    [InlineData("bad\0text")]
    [InlineData("bad\u001btext")]
    [InlineData("txt.exe \u202E gpj")]
    [InlineData("isolate \u2066 x")]
    [InlineData("isolate \u2069 x")]
    public void Text_that_cannot_be_kept_gets_an_error(string text)
        => HabitService.FeedbackTextError(text).Should().NotBeNull();

    [Theory]
    [InlineData("plain")]
    [InlineData("tabs\tand\r\nlines\n")]
    [InlineData("emoji \U0001F525 pair")]
    [InlineData("Umlaute äöü ß and 日本語")]
    public void Ordinary_text_has_no_error(string text)
        => HabitService.FeedbackTextError(text).Should().BeNull();

    [Theory]
    [InlineData(0xD800)]
    [InlineData(0xDC00)]
    [InlineData(0xDBFF)]
    public void An_unpaired_surrogate_gets_an_error_alone_or_inside_a_text(int codeUnit)
    {
        var lone = ((char)codeUnit).ToString();

        HabitService.FeedbackTextError("bad " + lone + " text").Should().NotBeNull();
        HabitService.FeedbackTextError("ends with " + lone).Should().NotBeNull();
    }

    [Fact]
    public void The_length_limit_is_2000_code_units()
    {
        HabitService.FeedbackTextError(new string('x', 2000)).Should().BeNull();
        HabitService.FeedbackTextError(new string('x', 2001)).Should().NotBeNull();
    }
}

[Collection("Integration")]
public class FeedbackBotStorageTests
{
    private static Task<List<Feedback>> StoredAsync(IntegrationTestHost host)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Feedback.AsNoTracking().ToListAsync());

    private static Task SubmitAsDiscordUserAsync(IntegrationTestHost host, ulong discordId, string text)
        => host.WithScopeAsync(async sp =>
        {
            var habits = sp.GetRequiredService<HabitService>();
            var userId = await habits.FindDiscordUserAsync(discordId);
            await habits.SaveFeedbackAsync(userId == Guid.Empty ? null : userId, "discord", null, text);
        });

    [Fact]
    public async Task A_discord_user_with_an_account_has_their_feedback_linked_to_it()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false);
        var userId = await host.WithScopeAsync(sp => sp.GetRequiredService<HabitService>().ResolveOrCreateDiscordUserAsync(123456789012345678));

        await SubmitAsDiscordUserAsync(host, 123456789012345678, "linked");

        var item = (await StoredAsync(host)).Should().ContainSingle().Subject;
        (item.UserId, item.Platform, item.Version, item.Text).Should().Be((userId, "discord", (string?)null, "linked"));
    }

    [Fact]
    public async Task An_unknown_discord_user_has_their_feedback_stored_without_a_user_and_no_account_is_created()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false);

        await SubmitAsDiscordUserAsync(host, 223456789012345678, "anonymous");

        (await StoredAsync(host)).Should().ContainSingle().Which.UserId.Should().BeNull();
        (await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users.CountAsync())).Should().Be(0);
    }
}
