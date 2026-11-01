using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class MergeTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string MergeUrl = "/api/account/merge";

    /// <summary>A bot-only user with consent, one habit per name (each checked in today) and low days on the given offsets from today.</summary>
    private async Task<(Guid UserId, ulong DiscordId)> BotOnlyAsync(string[] habitNames, params int[] lowDayOffsets)
    {
        var discordId = ApiHost.NewDiscordId();
        var userId = await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(discordId));
        await Host.Run(s => s.GiveHealthDataConsentAsync(userId));
        foreach (var name in habitNames)
        {
            var habit = await Host.Service(s => s.AddHabitAsync(userId, name, null));
            await Host.Run(s => s.CheckInAsync(userId, habit.Id, Host.Today, true));
        }
        foreach (var offset in lowDayOffsets)
            await Host.Run(s => s.SetLowDayAsync(userId, Host.Today.AddDays(offset)));
        return (userId, discordId);
    }

    private async Task StartMergeAsync(ApiClient user, ulong botDiscordId)
        => (await Host.DiscordAsync(user, "/api/auth/discord/link", botDiscordId)).Should().Be("/link/merge");

    private Task<bool> UserExists(Guid id) => Host.Db(db => db.Users.AnyAsync(u => u.Id == id));

    [DockerFact]
    public async Task Preview_counts_what_would_move_and_shows_the_signed_in_accounts_settings()
    {
        var user = await Host.SignedInAsync();
        await (await user.Patch("/api/me", new { graceDaysPerWeek = 2, leaderboardOptIn = true })).ExpectJson();
        var bot = await BotOnlyAsync(["Water", "Read"], 0);
        await StartMergeAsync(user, bot.DiscordId);

        var preview = await (await user.Get(MergeUrl)).ExpectJson();

        preview.GetProperty("habits").GetInt32().Should().Be(2);
        preview.GetProperty("logs").GetInt32().Should().Be(2);
        preview.GetProperty("dayMarks").GetInt32().Should().Be(1);
        preview.GetProperty("habitNames").EnumerateArray().Select(n => n.GetString()).Should().Equal("Water", "Read");
        var kept = preview.GetProperty("kept");
        kept.GetProperty("graceDaysPerWeek").GetInt32().Should().Be(2);
        kept.GetProperty("leaderboardOptIn").GetBoolean().Should().BeTrue();
        kept.GetProperty("timezone").GetString().Should().Be("UTC");
        (await UserExists(bot.UserId)).Should().BeTrue();
    }

    [DockerFact]
    public async Task Merging_moves_habits_logs_and_day_marks_deletes_the_bot_user_and_points_the_login_at_the_account()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        var today = Host.Today.Iso();
        var ownHabit = (await user.CreateHabitAsync("Water")).GetProperty("id").GetInt32();
        await (await user.Put($"/api/habits/{ownHabit}/days/{today}", new { completed = true })).ExpectJson();
        await (await user.Put($"/api/low-days/{today}")).Expect(HttpStatusCode.NoContent);
        var bot = await BotOnlyAsync(["Water", "Read"], 0, -1);
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        var habits = await (await user.Get("/api/habits")).ExpectJson();
        habits.EnumerateArray().Select(h => h.GetProperty("name").GetString()).Should().BeEquivalentTo("Water", "Water", "Read");
        (await UserExists(bot.UserId)).Should().BeFalse();
        (await Host.Service(s => s.FindDiscordUserAsync(bot.DiscordId))).Should().Be(userId);
        (await Host.Db(db => db.HabitLogs.CountAsync(l => l.Habit.UserId == userId))).Should().Be(3);
        (await Host.Db(db => db.DayMarks.CountAsync(m => m.UserId == userId && m.Date == Host.Today))).Should().Be(1);
        (await (await user.Get("/api/low-days")).ExpectJson()).GetArrayLength().Should().Be(2);
        var me = await (await user.Get("/api/me")).ExpectJson();
        me.GetProperty("discord").GetProperty("id").GetString().Should().Be(bot.DiscordId.ToString());
        user.CookieValue("ember.merge", MergeUrl).Should().BeNull();
        await (await user.Get(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
    }

    [DockerFact]
    public async Task Merging_reschedules_moved_reminders_in_the_signed_in_accounts_timezone()
    {
        var user = await Host.SignedInAsync();
        await (await user.Patch("/api/me", new { timezone = "Europe/Berlin" })).ExpectJson();
        var bot = await BotOnlyAsync([]);
        var habit = await Host.Service(s => s.AddHabitAsync(bot.UserId, "Water", new TimeOnly(9, 0)));
        var before = await Host.Db(db => db.Habits.Where(h => h.Id == habit.Id).Select(h => h.NextReminderUtc).SingleAsync());
        before.Should().Be(new DateTime(2026, 11, 2, 9, 0, 0, DateTimeKind.Utc));
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        var after = await Host.Db(db => db.Habits.Where(h => h.Id == habit.Id).Select(h => h.NextReminderUtc).SingleAsync());
        after.Should().Be(new DateTime(2026, 11, 2, 8, 0, 0, DateTimeKind.Utc));
    }

    [DockerFact]
    public async Task The_habit_limit_does_not_block_a_merge()
    {
        var user = await Host.SignedInAsync();
        for (var i = 0; i < 24; i++)
            await user.CreateHabitAsync();
        var bot = await BotOnlyAsync(["Water", "Read"]);
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        (await (await user.Get("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(26);
    }

    [DockerFact]
    public async Task Merging_without_consent_is_refused_and_moves_nothing_until_consent_is_given()
    {
        var user = await Host.SignedInAsync(consent: false);
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.Forbidden, "consent_required");

        (await UserExists(bot.UserId)).Should().BeTrue();
        (await Host.Db(db => db.Habits.CountAsync(h => h.UserId == bot.UserId))).Should().Be(1);
        await user.GiveConsentAsync();
        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);
    }

    [DockerFact]
    public async Task A_pending_merge_expires_after_15_minutes()
    {
        var user = await Host.SignedInAsync();
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(user, bot.DiscordId);
        (await user.Get(MergeUrl)).StatusCode.Should().Be(HttpStatusCode.OK);

        Host.Time.Advance(TimeSpan.FromMinutes(16));

        await (await user.Get(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        (await UserExists(bot.UserId)).Should().BeTrue();
    }

    [DockerFact]
    public async Task A_merge_cookie_cannot_be_replayed_after_the_merge()
    {
        var user = await Host.SignedInAsync();
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(user, bot.DiscordId);
        var cookie = user.CookieValue("ember.merge", MergeUrl)!;
        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        user.AddCookie("ember.merge", cookie, MergeUrl);
        await user.RefreshCsrfAsync();

        await (await user.Get(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
    }

    [DockerFact]
    public async Task Another_users_merge_cookie_is_ignored()
    {
        var starter = await Host.SignedInAsync();
        var other = await Host.SignedInAsync();
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(starter, bot.DiscordId);
        other.AddCookie("ember.merge", starter.CookieValue("ember.merge", MergeUrl)!, MergeUrl);

        await (await other.Get(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await other.Post(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");

        (await UserExists(bot.UserId)).Should().BeTrue();
        (await Host.Db(db => db.Habits.CountAsync(h => h.UserId == bot.UserId))).Should().Be(1);
    }

    [DockerFact]
    public async Task A_source_that_changed_between_preview_and_confirm_is_a_conflict_and_nothing_moves()
    {
        var user = await Host.SignedInAsync();
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(user, bot.DiscordId);
        await Host.Run(s => s.DeleteUserDataAsync(bot.UserId));
        var recreated = await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(bot.DiscordId));

        await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.Conflict, "conflict");

        (await UserExists(recreated)).Should().BeTrue();
        (await Host.Service(s => s.FindDiscordUserAsync(bot.DiscordId))).Should().Be(recreated);
        (await (await user.Get("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(0);
    }

    [DockerFact]
    public async Task Cancelling_a_pending_merge_discards_it()
    {
        var user = await Host.SignedInAsync();
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Delete(MergeUrl)).Expect(HttpStatusCode.NoContent);

        await (await user.Get(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        (await UserExists(bot.UserId)).Should().BeTrue();
    }
}
