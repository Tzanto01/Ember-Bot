using System.Net;
using FluentAssertions;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class AuthRateLimitTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new()
    {
        ["Ember:RateLimits:AuthPerIpPerMinute"] = "30",
        ["Ember:RateLimits:AuthOtherPerIpPerMinute"] = "300",
    };

    private static Task<HttpResponseMessage> WrongLogin(ApiClient client)
        => client.Post("/api/auth/login", new Credentials(ApiHost.NewEmail(), ApiClient.Passphrase));

    [DockerFact]
    public async Task Antiforgery_traffic_does_not_consume_the_login_or_discord_budget()
    {
        var client = Host.NewClient();
        for (var i = 0; i < 50; i++)
            await (await client.Get("/api/auth/antiforgery")).Expect(HttpStatusCode.NoContent);

        await (await WrongLogin(client)).Expect(HttpStatusCode.Unauthorized);
        (await client.Get("/api/auth/discord/login?returnUrl=/today")).StatusCode.Should().Be(HttpStatusCode.Redirect);
    }

    [DockerFact]
    public async Task Credential_endpoints_are_limited_strictly_and_apart_from_the_other_auth_endpoints()
    {
        var client = Host.NewClient();
        for (var i = 0; i < 30; i++)
            await (await WrongLogin(client)).Expect(HttpStatusCode.Unauthorized);

        var limited = await WrongLogin(client);

        await limited.ExpectProblem((HttpStatusCode)429, "rate_limited");
        limited.Headers.RetryAfter!.Delta.Should().BeGreaterThan(TimeSpan.Zero);
        await (await client.Post("/api/auth/confirmEmail", new ConfirmRequest(Guid.NewGuid().ToString(), "x", ApiClient.Passphrase)))
            .ExpectProblem((HttpStatusCode)429, "rate_limited");
        await (await client.Get("/api/auth/antiforgery")).Expect(HttpStatusCode.NoContent);
        (await client.Get("/api/auth/discord/login?returnUrl=/today")).StatusCode.Should().Be(HttpStatusCode.Redirect);
    }

    [DockerFact]
    public async Task Two_factor_code_endpoints_share_the_credential_limit()
    {
        var client = await Host.SignedInAsync(consent: false);
        while ((await WrongLogin(client)).StatusCode != (HttpStatusCode)429) { }

        await (await client.Post("/api/me/2fa/setup")).ExpectProblem((HttpStatusCode)429, "rate_limited");
        await (await client.Post("/api/me/2fa/enable", new { code = "123456" })).ExpectProblem((HttpStatusCode)429, "rate_limited");
        await (await client.Post("/api/me/2fa/disable", new { password = ApiClient.Passphrase })).ExpectProblem((HttpStatusCode)429, "rate_limited");
        await (await client.Post("/api/me/2fa/recovery-codes", new { code = "123456" })).ExpectProblem((HttpStatusCode)429, "rate_limited");
        await (await Host.NewClient().Post("/api/auth/discord/2fa", new { code = "123456" })).ExpectProblem((HttpStatusCode)429, "rate_limited");
        await (await client.Get("/api/me/2fa")).Expect(HttpStatusCode.OK);
    }
}

[Collection("Postgres")]
public class AuthOtherRateLimitTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new() { ["Ember:RateLimits:AuthOtherPerIpPerMinute"] = "3" };

    [DockerFact]
    public async Task Non_credential_auth_endpoints_still_have_a_cap_and_leave_login_untouched()
    {
        var client = Host.NewClient();
        for (var i = 0; i < 3; i++)
            await (await client.Get("/api/auth/antiforgery")).Expect(HttpStatusCode.NoContent);

        await (await client.Get("/api/auth/antiforgery")).ExpectProblem((HttpStatusCode)429, "rate_limited");
        await (await client.Post("/api/auth/login", new Credentials(ApiHost.NewEmail(), ApiClient.Passphrase))).Expect(HttpStatusCode.Unauthorized);
    }

    [DockerFact]
    public async Task The_discord_callback_answered_by_the_oauth_handler_is_capped_too()
    {
        var client = Host.NewClient();
        for (var i = 0; i < 3; i++)
            (await client.Get("/api/auth/discord/callback?state=x&code=y")).StatusCode.Should().NotBe((HttpStatusCode)429);

        await (await client.Get("/api/auth/discord/callback?state=x&code=y")).ExpectProblem((HttpStatusCode)429, "rate_limited");
    }
}
