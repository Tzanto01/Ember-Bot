using System.Net;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

public abstract class FeedbackRateLimitTestBase(PostgresFixture postgres) : ApiTestBase(postgres)
{
    protected ApiClient ClientAt(string ip)
    {
        var client = Host.NewClient();
        client.Http.DefaultRequestHeaders.Add("X-Forwarded-For", ip);
        return client;
    }

    protected static Task<HttpResponseMessage> Send(ApiClient client)
        => client.Post("/api/feedback", new { text = "Great app", platform = "web" });

    protected static async Task<int> Status(ApiClient client) => (int)(await Send(client)).StatusCode;
}

[Collection("Postgres")]
public class FeedbackPerSenderRateLimitTests(PostgresFixture postgres) : FeedbackRateLimitTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new()
    {
        ["Ember:RateLimits:FeedbackPerHour"] = "2",
        ["Ember:RateLimits:MailPerIpPerHour"] = "1",
    };

    [DockerFact]
    public async Task One_ip_is_limited_with_a_429_problem_and_retry_after_while_another_ip_still_passes()
    {
        var client = ClientAt("203.0.113.1");
        (await Status(client)).Should().Be(204);
        (await Status(client)).Should().Be(204);

        var limited = await Send(client);

        await limited.ExpectProblem((HttpStatusCode)429, "rate_limited");
        limited.Headers.RetryAfter!.Delta.Should().BeGreaterThan(TimeSpan.Zero);
        (await Status(ClientAt("203.0.113.2"))).Should().Be(204);
    }

    [DockerFact]
    public async Task A_limited_request_is_not_stored()
    {
        var client = ClientAt("203.0.113.1");
        for (var i = 0; i < 3; i++) await Send(client);

        (await Host.Db(db => db.Feedback.CountAsync())).Should().Be(2);
    }

    [DockerFact]
    public async Task Feedback_does_not_use_up_the_mail_budget_of_the_same_ip()
    {
        var client = ClientAt("203.0.113.1");
        (await Status(client)).Should().Be(204);
        (await Status(client)).Should().Be(204);
        (await Status(client)).Should().Be(429);

        var forgot = await client.Post("/api/auth/forgotPassword", new { email = ApiHost.NewEmail() });

        forgot.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Mail_requests_do_not_use_up_the_feedback_budget_of_the_same_ip()
    {
        var client = ClientAt("203.0.113.1");
        (await client.Post("/api/auth/forgotPassword", new { email = ApiHost.NewEmail() })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await client.Post("/api/auth/forgotPassword", new { email = ApiHost.NewEmail() })).StatusCode.Should().Be((HttpStatusCode)429);

        (await Status(client)).Should().Be(204);
        (await Status(client)).Should().Be(204);
    }
}

[Collection("Postgres")]
public class FeedbackDailyRateLimitTests(PostgresFixture postgres) : FeedbackRateLimitTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new()
    {
        ["Ember:RateLimits:FeedbackPerHour"] = "2",
        ["Ember:RateLimits:FeedbackPerDay"] = "3",
        ["Ember:RateLimits:MailPerDay"] = "1",
    };

    [DockerFact]
    public async Task Feedback_across_all_senders_stops_at_the_daily_cap()
    {
        (await Status(ClientAt("203.0.113.1"))).Should().Be(204);
        (await Status(ClientAt("203.0.113.2"))).Should().Be(204);
        (await Status(ClientAt("203.0.113.3"))).Should().Be(204);

        var limited = await Send(ClientAt("203.0.113.4"));

        await limited.ExpectProblem((HttpStatusCode)429, "rate_limited");
        limited.Headers.RetryAfter!.Delta.Should().BeGreaterThan(TimeSpan.Zero);
    }

    [DockerFact]
    public async Task A_sender_over_their_own_limit_does_not_use_up_the_daily_allowance()
    {
        var spammer = ClientAt("203.0.113.1");
        for (var i = 0; i < 6; i++) await Send(spammer);

        (await Status(ClientAt("203.0.113.2"))).Should().Be(204);
    }

    [DockerFact]
    public async Task Feedback_does_not_use_up_the_daily_mail_budget()
    {
        for (var i = 1; i <= 3; i++) (await Status(ClientAt($"203.0.113.{i}"))).Should().Be(204);

        var forgot = await ClientAt("198.51.100.9").Post("/api/auth/forgotPassword", new { email = ApiHost.NewEmail() });

        forgot.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}

[Collection("Postgres")]
public class FeedbackPerUserRateLimitTests(PostgresFixture postgres) : FeedbackRateLimitTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new() { ["Ember:RateLimits:FeedbackPerHour"] = "2" };

    [DockerFact]
    public async Task A_signed_in_user_is_limited_by_account_not_by_ip_and_anonymous_callers_of_that_ip_are_not_affected()
    {
        var first = await Host.SignedInAsync(consent: false);
        var second = await Host.SignedInAsync(consent: false);
        (await Status(first)).Should().Be(204);
        (await Status(first)).Should().Be(204);

        (await Status(first)).Should().Be(429);
        (await Status(second)).Should().Be(204);
        (await Status(Host.NewClient())).Should().Be(204);
    }
}

[Collection("Postgres")]
public class FeedbackDailySignedInRateLimitTests(PostgresFixture postgres) : FeedbackRateLimitTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new() { ["Ember:RateLimits:FeedbackPerDay"] = "1" };

    [DockerFact]
    public async Task Signed_in_senders_are_not_stopped_by_the_daily_cap_that_anonymous_senders_used_up()
    {
        var user = await Host.SignedInAsync(consent: false);
        (await Status(ClientAt("203.0.113.1"))).Should().Be(204);
        (await Status(ClientAt("203.0.113.2"))).Should().Be(429);

        (await Status(user)).Should().Be(204);
    }

    [DockerFact]
    public async Task Signed_in_feedback_does_not_use_up_the_anonymous_daily_allowance()
    {
        var user = await Host.SignedInAsync(consent: false);
        (await Status(user)).Should().Be(204);
        (await Status(user)).Should().Be(204);

        (await Status(ClientAt("203.0.113.1"))).Should().Be(204);
    }
}
