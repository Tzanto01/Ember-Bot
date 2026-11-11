using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Ember.Api.TestHost;
using FluentAssertions;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class NativeDiscordTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string Login = "/api/auth/discord/login";
    private const string Token = "/api/auth/discord/native/token";
    private const string Redirect = "app.ember.habits://auth/discord";
    private const string Error = Redirect + "?error=discord";

    private static (string Verifier, string Challenge) Pkce()
    {
        var verifier = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        return (verifier, WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))));
    }

    private static string NativeLogin(string challenge) => $"{Login}?client=native&challenge={challenge}&returnUrl=/habits";

    /// <summary>Runs the native flow in a browser client for <paramref name="discordId"/>; returns the one-time code from the app redirect.</summary>
    private async Task<string> CodeAsync(ulong discordId, string challenge)
    {
        var browser = Host.NewClient();
        var target = await Host.DiscordAsync(browser, NativeLogin(challenge), discordId);
        target.Should().StartWith(Redirect + "?code=");
        await (await browser.Get("/api/me")).Expect(HttpStatusCode.Unauthorized);
        var query = QueryHelpers.ParseQuery(new Uri(target).Query);
        query.Keys.Should().Equal("code");
        return query["code"].ToString();
    }

    private Task<HttpResponseMessage> ExchangeAsync(string code, string verifier, string? twoFactorCode = null)
        => Host.NewClient().Post(Token, new { code, verifier, twoFactorCode });

    private static async Task<string> Detail(HttpResponseMessage response)
        => (await response.ExpectProblem(HttpStatusCode.Unauthorized)).GetProperty("detail").GetString()!;

    private ApiClient BearerClient(JsonElement tokens)
    {
        var client = Host.NewClient();
        client.Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());
        return client;
    }

    [DockerFact]
    public async Task Native_discord_sign_in_hands_the_app_a_code_that_its_verifier_turns_into_bearer_tokens_with_a_live_session()
    {
        var discordId = ApiHost.NewDiscordId();
        var (verifier, challenge) = Pkce();

        var code = await CodeAsync(discordId, challenge);
        var tokens = await (await ExchangeAsync(code, verifier)).ExpectJson();

        tokens.GetProperty("tokenType").GetString().Should().Be("Bearer");
        var app = BearerClient(tokens);
        var me = await (await app.Get("/api/me")).ExpectJson();
        me.GetProperty("discord").GetProperty("id").GetString().Should().Be(discordId.ToString());
        var userId = me.GetProperty("id").GetGuid();
        (await Host.Db(db => db.AuthSessions.CountAsync(s => s.UserId == userId))).Should().Be(1);
        await (await Host.NewClient().Post("/api/auth/refresh", new { refreshToken = tokens.GetProperty("refreshToken").GetString() }))
            .Expect(HttpStatusCode.OK);

        await (await app.Post("/api/auth/logout")).Expect(HttpStatusCode.NoContent);
        await (await app.Get("/api/me")).Expect(HttpStatusCode.Unauthorized);
    }

    [DockerFact]
    public async Task A_wrong_verifier_burns_the_code()
    {
        var (verifier, challenge) = Pkce();
        var code = await CodeAsync(ApiHost.NewDiscordId(), challenge);

        (await Detail(await ExchangeAsync(code, Pkce().Verifier))).Should().Be("Failed");
        (await Detail(await ExchangeAsync(code, verifier))).Should().Be("Failed");
    }

    [DockerFact]
    public async Task A_code_works_once()
    {
        var (verifier, challenge) = Pkce();
        var code = await CodeAsync(ApiHost.NewDiscordId(), challenge);

        await (await ExchangeAsync(code, verifier)).Expect(HttpStatusCode.OK);
        (await Detail(await ExchangeAsync(code, verifier))).Should().Be("Failed");
    }

    [DockerFact]
    public async Task A_code_expires_after_two_minutes()
    {
        var (verifier, challenge) = Pkce();
        var code = await CodeAsync(ApiHost.NewDiscordId(), challenge);

        Host.Time.Advance(TimeSpan.FromMinutes(2) + TimeSpan.FromSeconds(1));

        (await Detail(await ExchangeAsync(code, verifier))).Should().Be("Failed");
    }

    [DockerFact]
    public async Task A_2fa_account_needs_the_second_factor_bound_to_the_code()
    {
        var discordId = ApiHost.NewDiscordId();
        var owner = Host.NewClient();
        await Host.DiscordAsync(owner, Login, discordId);
        await owner.RefreshCsrfAsync();
        var key = (await (await owner.Post("/api/me/2fa/setup")).ExpectJson()).GetProperty("sharedKey").GetString()!;
        await (await owner.Post("/api/me/2fa/enable", new { code = Totp.Code(key) })).Expect(HttpStatusCode.OK);
        var (verifier, challenge) = Pkce();
        var code = await CodeAsync(discordId, challenge);

        (await Detail(await ExchangeAsync(code, verifier))).Should().Be("RequiresTwoFactor");
        (await Detail(await ExchangeAsync(code, verifier, Totp.Code(key, 10)))).Should().Be("Failed");
        (await Detail(await ExchangeAsync(code, Pkce().Verifier, Totp.Code(key)))).Should().Be("Failed");

        var other = Pkce();
        var second = await CodeAsync(discordId, other.Challenge);
        (await Detail(await ExchangeAsync(second, other.Verifier))).Should().Be("RequiresTwoFactor");
        var tokens = await (await ExchangeAsync(second, other.Verifier, Totp.Code(key))).ExpectJson();
        await (await BearerClient(tokens).Get("/api/me")).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Asking_again_without_the_second_factor_does_not_extend_the_code()
    {
        var discordId = ApiHost.NewDiscordId();
        var owner = Host.NewClient();
        await Host.DiscordAsync(owner, Login, discordId);
        await owner.RefreshCsrfAsync();
        var key = (await (await owner.Post("/api/me/2fa/setup")).ExpectJson()).GetProperty("sharedKey").GetString()!;
        await (await owner.Post("/api/me/2fa/enable", new { code = Totp.Code(key) })).Expect(HttpStatusCode.OK);
        var (verifier, challenge) = Pkce();
        var code = await CodeAsync(discordId, challenge);

        (await Detail(await ExchangeAsync(code, verifier))).Should().Be("RequiresTwoFactor");
        Host.Time.Advance(TimeSpan.FromMinutes(4));
        (await Detail(await ExchangeAsync(code, verifier))).Should().Be("RequiresTwoFactor");
        Host.Time.Advance(TimeSpan.FromMinutes(1) + TimeSpan.FromSeconds(1));

        (await Detail(await ExchangeAsync(code, verifier, Totp.Code(key)))).Should().Be("Failed");
    }

    [DockerFact]
    public async Task A_bad_challenge_or_a_cancelled_native_login_redirects_to_the_app_error()
    {
        var response = await Host.NewClient().Get($"{Login}?client=native&challenge=short");
        response.StatusCode.Should().Be(HttpStatusCode.Redirect);
        response.Headers.Location!.OriginalString.Should().Be(Error);

        (await Host.DiscordAsync(Host.NewClient(), NativeLogin(Pkce().Challenge), deny: true)).Should().Be(Error);
        (await Host.DiscordAsync(Host.NewClient(), NativeLogin(Pkce().Challenge))).Should().Be(Error);
    }
}
