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
