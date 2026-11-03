using System.Net;
using FluentAssertions;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class RateLimitTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new() { ["Ember:RateLimits:MailPerEmailPerHour"] = "2" };

    [DockerFact]
    public async Task Forgot_password_is_limited_per_email_with_a_429_problem_and_retry_after()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        await (await client.Post("/api/auth/forgotPassword", new { email })).Expect(HttpStatusCode.OK);
        await (await client.Post("/api/auth/forgotPassword", new { email })).Expect(HttpStatusCode.OK);

        var limited = await client.Post("/api/auth/forgotPassword", new { email });

        await limited.ExpectProblem((HttpStatusCode)429, "rate_limited");
        limited.Headers.RetryAfter!.Delta.Should().BeGreaterThan(TimeSpan.Zero);
        await (await client.Post("/api/auth/forgotPassword", new { email = ApiHost.NewEmail() })).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task The_per_email_limit_is_per_endpoint()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        await (await client.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        await (await client.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        await (await client.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).ExpectProblem((HttpStatusCode)429, "rate_limited");

        await (await client.Post("/api/auth/forgotPassword", new { email })).Expect(HttpStatusCode.OK);
    }
}

/// <summary>Mail limits across client IPs, each request forwarded for the given address.</summary>
public abstract class MailRateLimitTestBase(PostgresFixture postgres) : ApiTestBase(postgres)
{
    protected async Task<int> ForgotPassword(string ip, string email)
    {
        var client = Host.NewClient();
        client.Http.DefaultRequestHeaders.Add("X-Forwarded-For", ip);
        return (int)(await client.Post("/api/auth/forgotPassword", new { email })).StatusCode;
    }
}

[Collection("Postgres")]
public class MailPerIpRateLimitTests(PostgresFixture postgres) : MailRateLimitTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new() { ["Ember:RateLimits:MailPerIpPerHour"] = "2" };

    [DockerFact]
    public async Task One_ip_cannot_mail_unlimited_address_variants()
    {
        (await ForgotPassword("203.0.113.1", ApiHost.NewEmail())).Should().Be(200);
        (await ForgotPassword("203.0.113.1", ApiHost.NewEmail())).Should().Be(200);

        (await ForgotPassword("203.0.113.1", ApiHost.NewEmail())).Should().Be(429);
        (await ForgotPassword("203.0.113.2", ApiHost.NewEmail())).Should().Be(200);
    }
}

[Collection("Postgres")]
public class MailPerDayRateLimitTests(PostgresFixture postgres) : MailRateLimitTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new() { ["Ember:RateLimits:MailPerDay"] = "2" };

    [DockerFact]
    public async Task Mails_across_all_clients_stop_at_the_daily_cap()
    {
        (await ForgotPassword("203.0.113.1", ApiHost.NewEmail())).Should().Be(200);
        (await ForgotPassword("203.0.113.2", ApiHost.NewEmail())).Should().Be(200);

        (await ForgotPassword("203.0.113.3", ApiHost.NewEmail())).Should().Be(429);
    }
}

[Collection("Postgres")]
public class MailPerEmailAndIpRateLimitTests(PostgresFixture postgres) : MailRateLimitTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new()
    {
        ["Ember:RateLimits:MailPerEmailPerHour"] = "2",
        ["Ember:RateLimits:MailPerEmailAnyClientPerHour"] = "3",
    };

    [DockerFact]
    public async Task An_attacker_exhausting_an_address_from_one_ip_does_not_block_its_owner_but_the_address_has_a_backstop()
    {
        var email = ApiHost.NewEmail();
        (await ForgotPassword("203.0.113.66", email)).Should().Be(200);
        (await ForgotPassword("203.0.113.66", email)).Should().Be(200);
        (await ForgotPassword("203.0.113.66", email)).Should().Be(429);

        (await ForgotPassword("198.51.100.7", email)).Should().Be(200);

        (await ForgotPassword("192.0.2.9", email)).Should().Be(429);
    }
}
