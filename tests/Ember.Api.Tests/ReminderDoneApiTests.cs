using System.Net;
using System.Security.Cryptography;
using System.Text;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class ReminderDoneApiTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string Done = "/api/reminders/done";

    private async Task<(ApiClient User, Guid UserId, int HabitId)> HabitAsync(int timesPerDay = 1)
    {
        var user = await Host.SignedInAsync();
        var habit = await (await user.Post("/api/habits", new { name = "Walk", frequency = "daily", timesPerDay })).ExpectJson(HttpStatusCode.Created);
        return (user, await user.IdAsync(), habit.GetProperty("id").GetInt32());
    }

    /// <summary>A token for the habit on the host's today, expiring like a reminder: 10:00 local the next day.</summary>
    private Task<string> TokenAsync(Guid userId, int habitId)
        => Host.Service(h => h.CreateReminderActionTokenAsync(userId, habitId, Host.Today, Host.Today.AddDays(1).ToDateTime(new TimeOnly(10, 0))));

    private Task<int?> CountAsync(int habitId, DateOnly day)
        => Host.Db(db => db.HabitLogs.Where(l => l.HabitId == habitId && l.Date == day).Select(l => (int?)l.Count).SingleOrDefaultAsync());

    [DockerFact]
    public async Task A_token_checks_in_its_habit_on_the_reminders_day_without_a_session_and_stores_only_its_hash()
    {
        var (_, userId, habitId) = await HabitAsync(timesPerDay: 3);
        var day = Host.Today;
        var token = await TokenAsync(userId, habitId);
        Host.Time.Advance(TimeSpan.FromHours(14));

        await (await Host.NewClient().Post(Done, new { token })).Expect(HttpStatusCode.NoContent);

        (await CountAsync(habitId, day)).Should().Be(1);
        (await CountAsync(habitId, day.AddDays(1))).Should().BeNull();
        var stored = await Host.Db(db => db.ReminderActionTokens.SingleAsync(t => t.HabitId == habitId));
        stored.TokenHash.Should().Equal(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        stored.UsedUtc.Should().NotBeNull();
    }

    [DockerFact]
    public async Task A_cookie_session_without_an_antiforgery_token_is_not_refused()
    {
        var (user, userId, habitId) = await HabitAsync();
        var token = await TokenAsync(userId, habitId);
        user.Csrf = null;

        await (await user.Post(Done, new { token })).Expect(HttpStatusCode.NoContent);

        (await CountAsync(habitId, Host.Today)).Should().Be(1);
    }

    [DockerFact]
    public async Task A_used_token_answers_204_again_without_adding_another_check_in()
    {
        var (_, userId, habitId) = await HabitAsync(timesPerDay: 3);
        var token = await TokenAsync(userId, habitId);
        var anonymous = Host.NewClient();

        await (await anonymous.Post(Done, new { token })).Expect(HttpStatusCode.NoContent);
        await (await anonymous.Post(Done, new { token })).Expect(HttpStatusCode.NoContent);

        (await CountAsync(habitId, Host.Today)).Should().Be(1);
    }

    [DockerFact]
    public async Task An_expired_token_answers_410_and_writes_nothing_and_the_daily_purge_removes_it()
    {
        var (_, userId, habitId) = await HabitAsync();
        var token = await TokenAsync(userId, habitId);
        Host.Time.Advance(TimeSpan.FromHours(22));

        await (await Host.NewClient().Post(Done, new { token })).ExpectProblem(HttpStatusCode.Gone, "expired");

        (await CountAsync(habitId, Host.Today.AddDays(-1))).Should().BeNull();
        (await Host.Service(h => h.DeleteExpiredReminderActionTokensAsync())).Should().Be(1);
        (await Host.Db(db => db.ReminderActionTokens.CountAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task The_purge_keeps_tokens_that_have_not_expired()
    {
        var (_, userId, habitId) = await HabitAsync();
        await TokenAsync(userId, habitId);
        Host.Time.Advance(TimeSpan.FromHours(21));

        (await Host.Service(h => h.DeleteExpiredReminderActionTokensAsync())).Should().Be(0);
        (await Host.Db(db => db.ReminderActionTokens.CountAsync())).Should().Be(1);
    }

    [DockerFact]
    public async Task An_unknown_empty_or_overlong_token_answers_404()
    {
        var anonymous = Host.NewClient();
        var (_, userId, habitId) = await HabitAsync();
        var token = await TokenAsync(userId, habitId);

        foreach (var unknown in new[] { token[..^1] + (token[^1] == 'A' ? 'B' : 'A'), "", new string('a', 129) })
            await (await anonymous.Post(Done, new { token = unknown })).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await anonymous.Post(Done, new { })).ExpectProblem(HttpStatusCode.NotFound, "not_found");

        (await CountAsync(habitId, Host.Today)).Should().BeNull();
    }

    [DockerFact]
    public async Task Without_the_current_consent_nothing_is_written_and_the_token_still_works_after_consenting()
    {
        var (user, userId, habitId) = await HabitAsync();
        var token = await TokenAsync(userId, habitId);
        await Host.Db(db => db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s.SetProperty(u => u.ConsentPolicyVersion, "2020-01")));

        await (await Host.NewClient().Post(Done, new { token })).ExpectProblem(HttpStatusCode.Forbidden, "consent_required");
        (await CountAsync(habitId, Host.Today)).Should().BeNull();

        await user.GiveConsentAsync();
        await (await Host.NewClient().Post(Done, new { token })).Expect(HttpStatusCode.NoContent);
        (await CountAsync(habitId, Host.Today)).Should().Be(1);
    }

    [DockerFact]
    public async Task A_rejected_write_leaves_the_token_unused_instead_of_replaying_as_logged()
    {
        var (_, userId, habitId) = await HabitAsync();
        var token = await Host.Service(h => h.CreateReminderActionTokenAsync(userId, habitId, Host.Today.AddDays(-1),
            Host.Today.ToDateTime(new TimeOnly(10, 0)).AddDays(1)));

        await (await Host.NewClient().Post(Done, new { token })).ExpectProblem(HttpStatusCode.Gone, "expired");
        await (await Host.NewClient().Post(Done, new { token })).ExpectProblem(HttpStatusCode.Gone, "expired");

        (await Host.Db(db => db.ReminderActionTokens.SingleAsync())).UsedUtc.Should().BeNull();
    }

    private static readonly string Endpoint = $"https://fcm.googleapis.com/fcm/send/{Guid.NewGuid():N}";

    private static async Task SubscribeAsync(ApiClient client)
        => await (await client.Post("/api/me/push-subscriptions", new
        {
            endpoint = Endpoint,
            keys = new { p256dh = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(65)), auth = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(16)) },
        })).Expect(HttpStatusCode.NoContent);

    private Task<List<Guid?>> SubscriptionSessionsAsync()
        => Host.Db(db => db.PushSubscriptions.Select(s => s.SessionId).ToListAsync());

    private async Task<ApiClient> SecondDeviceAsync(ApiClient user)
    {
        var other = Host.NewClient();
        other.Email = user.Email;
        await other.LoginAsync();
        return other;
    }

    [DockerFact]
    public async Task A_subscription_remembers_its_session_and_a_plain_logout_deletes_it_server_side()
    {
        var (user, _, _) = await HabitAsync();
        await SubscribeAsync(user);
        (await SubscriptionSessionsAsync()).Should().ContainSingle().Which.Should().NotBeNull()
            .And.Be(await Host.Db(db => db.AuthSessions.Select(s => (Guid?)s.Id).SingleAsync()));

        await (await user.Post("/api/auth/logout")).Expect(HttpStatusCode.NoContent);

        (await SubscriptionSessionsAsync()).Should().BeEmpty();
    }

    [DockerFact]
    public async Task Logout_everywhere_deletes_the_subscriptions_of_the_ended_sessions_and_the_unused_tokens()
    {
        var (user, userId, habitId) = await HabitAsync();
        var intruder = await SecondDeviceAsync(user);
        await SubscribeAsync(intruder);
        var token = await TokenAsync(userId, habitId);

        await (await user.Post("/api/auth/logout-everywhere")).Expect(HttpStatusCode.NoContent);

        (await SubscriptionSessionsAsync()).Should().BeEmpty();
        (await Host.Db(db => db.ReminderActionTokens.CountAsync())).Should().Be(0);
        await (await Host.NewClient().Post(Done, new { token })).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        (await CountAsync(habitId, Host.Today)).Should().BeNull();
    }

    [DockerFact]
    public async Task A_password_reset_deletes_the_subscriptions_of_the_ended_sessions_and_the_unused_tokens()
    {
        var (user, userId, habitId) = await HabitAsync();
        var intruder = await SecondDeviceAsync(user);
        await SubscribeAsync(intruder);
        await TokenAsync(userId, habitId);
        await (await Host.NewClient().Post("/api/auth/forgotPassword", new { email = user.Email })).Expect(HttpStatusCode.OK);
        var code = QueryHelpers.ParseQuery(new Uri((await Host.Mail.WaitForAsync(user.Email, 2))[1].Link()).Query)["code"].ToString();

        await (await Host.NewClient().Post("/api/auth/resetPassword", new ResetRequest(user.Email, code, "another-long-passphrase")))
            .Expect(HttpStatusCode.OK);

        (await SubscriptionSessionsAsync()).Should().BeEmpty();
        (await Host.Db(db => db.ReminderActionTokens.CountAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task A_day_already_at_times_per_day_stays_capped()
    {
        var (user, userId, habitId) = await HabitAsync(timesPerDay: 2);
        await (await user.Put($"/api/habits/{habitId}/days/{Host.Today.Iso()}", new { count = 2 })).Expect(HttpStatusCode.OK);
        var token = await TokenAsync(userId, habitId);

        await (await Host.NewClient().Post(Done, new { token })).Expect(HttpStatusCode.NoContent);

        (await CountAsync(habitId, Host.Today)).Should().Be(2);
    }

    [DockerFact]
    public async Task Deleting_the_habit_deletes_its_tokens()
    {
        var (user, userId, habitId) = await HabitAsync();
        var token = await TokenAsync(userId, habitId);

        await (await user.Delete($"/api/habits/{habitId}")).Expect(HttpStatusCode.NoContent);

        (await Host.Db(db => db.ReminderActionTokens.CountAsync())).Should().Be(0);
        await (await Host.NewClient().Post(Done, new { token })).ExpectProblem(HttpStatusCode.NotFound, "not_found");
    }
}
