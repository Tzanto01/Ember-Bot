using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Ember.Api.TestHost;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class TwoFactorTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string DiscordLogin = "/api/auth/discord/login";
    private const string Wrong = ApiClient.Passphrase + "-not";

    private sealed record CodeLogin(string Email, string Password, string? TwoFactorCode = null, string? TwoFactorRecoveryCode = null);

    private static async Task<string> Detail(HttpResponseMessage response)
        => (await response.ExpectProblem(HttpStatusCode.Unauthorized)).GetProperty("detail").GetString()!;

    private static async Task<JsonElement> State(ApiClient client) => await (await client.Get("/api/me/2fa")).ExpectJson();

    /// <summary>Sets up and enables 2FA for the signed-in client; returns the shared key and the recovery codes.</summary>
    private static async Task<(string Key, string[] RecoveryCodes)> EnableAsync(ApiClient client)
    {
        var key = (await (await client.Post("/api/me/2fa/setup")).ExpectJson()).GetProperty("sharedKey").GetString()!;
        var enabled = await (await client.Post("/api/me/2fa/enable", new { code = Totp.Code(key), password = ApiClient.Passphrase })).ExpectJson();
        return (key, enabled.GetProperty("recoveryCodes").EnumerateArray().Select(c => c.GetString()!).ToArray());
    }

    private async Task<(ApiClient Client, string Key, string[] RecoveryCodes)> TwoFactorUserAsync()
    {
        var client = await Host.SignedInAsync(consent: false);
        var (key, codes) = await EnableAsync(client);
        return (client, key, codes);
    }

    private Task<HttpResponseMessage> Login(string email, string? code = null, string? recoveryCode = null, string secret = ApiClient.Passphrase,
        string query = "?useCookies=true", ApiClient? client = null)
        => (client ?? Host.NewClient()).Post("/api/auth/login" + query, new CodeLogin(email, secret, code, recoveryCode));

    private Task<int> FailedCount(string email)
        => Host.Db(db => db.Users.Where(u => u.Email == email).Select(u => u.AccessFailedCount).SingleAsync());

    [DockerFact]
    public async Task Enabling_needs_a_current_code_returns_ten_recovery_codes_and_keeps_the_caller_signed_in()
    {
        var client = await Host.SignedInAsync(consent: false);
        (await State(client)).GetProperty("enabled").GetBoolean().Should().BeFalse();
        await (await client.Post("/api/me/2fa/enable", new { code = "123456", password = ApiClient.Passphrase })).ExpectProblem(HttpStatusCode.BadRequest, "validation");

        var setup = await (await client.Post("/api/me/2fa/setup")).ExpectJson();
        var key = setup.GetProperty("sharedKey").GetString()!;
        setup.GetProperty("authenticatorUri").GetString().Should()
            .Be($"otpauth://totp/{Uri.EscapeDataString("Ember:" + client.Email)}?secret={key}&issuer=Ember&digits=6");
        var wrong = await (await client.Post("/api/me/2fa/enable", new { code = Totp.Code(key, 10), password = ApiClient.Passphrase }))
            .ExpectProblem(HttpStatusCode.BadRequest, "validation");
        wrong.GetProperty("errors").Has("code").Should().BeTrue();

        var enabled = await (await client.Post("/api/me/2fa/enable", new { code = Totp.Code(key), password = ApiClient.Passphrase })).ExpectJson();

        enabled.GetProperty("recoveryCodes").GetArrayLength().Should().Be(10);
        var state = await State(client);
        state.GetProperty("enabled").GetBoolean().Should().BeTrue();
        state.GetProperty("recoveryCodesLeft").GetInt32().Should().Be(10);
        Host.Time.Advance(TimeSpan.FromMinutes(6));
        await (await client.Get("/api/me")).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Repeating_setup_replaces_an_unconfirmed_key_but_never_the_active_one()
    {
        var client = await Host.SignedInAsync(consent: false);
        var first = (await (await client.Post("/api/me/2fa/setup")).ExpectJson()).GetProperty("sharedKey").GetString()!;
        var second = (await (await client.Post("/api/me/2fa/setup")).ExpectJson()).GetProperty("sharedKey").GetString()!;
        second.Should().NotBe(first);
        await (await client.Post("/api/me/2fa/enable", new { code = Totp.Code(first), password = ApiClient.Passphrase })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        await (await client.Post("/api/me/2fa/enable", new { code = Totp.Code(second), password = ApiClient.Passphrase })).Expect(HttpStatusCode.OK);

        await (await client.Post("/api/me/2fa/setup")).ExpectProblem(HttpStatusCode.Conflict, "conflict");

        await (await Login(client.Email, Totp.Code(second))).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Login_asks_for_the_code_only_after_the_right_password_and_accepts_it_for_cookie_and_bearer()
    {
        var (client, key, _) = await TwoFactorUserAsync();

        (await Detail(await Login(client.Email, secret: Wrong))).Should().Be("Failed");
        (await Detail(await Login(client.Email, Totp.Code(key), secret: Wrong))).Should().Be("Failed");
        (await Detail(await Login(client.Email))).Should().Be("RequiresTwoFactor");

        var cookie = Host.NewClient();
        await (await Login(client.Email, Totp.Code(key), client: cookie)).Expect(HttpStatusCode.OK);
        await (await cookie.Get("/api/me")).Expect(HttpStatusCode.OK);

        var tokens = await (await Login(client.Email, Totp.Code(key), query: "")).ExpectJson();
        var bearer = Host.NewClient();
        bearer.Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());
        await (await bearer.Get("/api/me")).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task A_recovery_code_signs_in_once()
    {
        var (client, _, codes) = await TwoFactorUserAsync();

        await (await Login(client.Email, recoveryCode: codes[0])).Expect(HttpStatusCode.OK);
        (await Detail(await Login(client.Email, recoveryCode: codes[0]))).Should().Be("Failed");

        (await FailedCount(client.Email)).Should().Be(1);
        (await State(client)).GetProperty("recoveryCodesLeft").GetInt32().Should().Be(9);
    }

    [DockerFact]
    public async Task Wrong_codes_after_the_right_password_lock_the_account_which_then_answers_failed_only()
    {
        var (client, key, codes) = await TwoFactorUserAsync();

        for (var i = 0; i < 5; i++)
            (await Detail(await Login(client.Email, Totp.Code(key, 10)))).Should().Be("Failed");

        (await Detail(await Login(client.Email))).Should().Be("Failed");
        (await Detail(await Login(client.Email, Totp.Code(key)))).Should().Be("Failed");
        (await Detail(await Login(client.Email, recoveryCode: codes[0]))).Should().Be("Failed");
    }

    [DockerFact]
    public async Task A_remembered_browser_still_needs_the_code_on_the_next_login()
    {
        var (client, key, _) = await TwoFactorUserAsync();
        var browser = Host.NewClient();
        await (await Login(client.Email, Totp.Code(key), client: browser)).Expect(HttpStatusCode.OK);
        await browser.Post("/api/auth/logout");

        (await Detail(await Login(client.Email, client: browser))).Should().Be("RequiresTwoFactor");
    }

    [DockerFact]
    public async Task Disabling_needs_the_password_and_removes_the_key_and_recovery_codes()
    {
        var (client, key, codes) = await TwoFactorUserAsync();

        var wrong = await (await client.Post("/api/me/2fa/disable", new { password = Wrong, code = Totp.Code(key) }))
            .ExpectProblem(HttpStatusCode.BadRequest, "validation");
        wrong.GetProperty("errors").Has("password").Should().BeTrue();
        await (await client.Post("/api/me/2fa/disable", new { password = ApiClient.Passphrase })).Expect(HttpStatusCode.NoContent);

        var state = await State(client);
        state.GetProperty("enabled").GetBoolean().Should().BeFalse();
        state.GetProperty("recoveryCodesLeft").GetInt32().Should().Be(0);
        await (await client.Post("/api/me/2fa/recovery-codes", new { code = Totp.Code(key) })).ExpectProblem(HttpStatusCode.Conflict, "conflict");
        Host.Time.Advance(TimeSpan.FromMinutes(6));
        await (await client.Get("/api/me")).Expect(HttpStatusCode.OK);
        await (await Login(client.Email)).Expect(HttpStatusCode.OK);

        var (newKey, _) = await EnableAsync(client);
        newKey.Should().NotBe(key);
        (await Detail(await Login(client.Email, recoveryCode: codes[1]))).Should().Be("Failed");
    }

    [DockerFact]
    public async Task New_recovery_codes_need_a_current_code_and_replace_the_old_ones()
    {
        var (client, key, old) = await TwoFactorUserAsync();

        await (await client.Post("/api/me/2fa/recovery-codes", new { code = Totp.Code(key, 10) })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        (await FailedCount(client.Email)).Should().Be(1);
        var fresh = await (await client.Post("/api/me/2fa/recovery-codes", new { code = Totp.Code(key) })).ExpectJson();

        var codes = fresh.GetProperty("recoveryCodes").EnumerateArray().Select(c => c.GetString()!).ToArray();
        codes.Should().HaveCount(10).And.NotIntersectWith(old);
        (await Detail(await Login(client.Email, recoveryCode: old[0]))).Should().Be("Failed");
        await (await Login(client.Email, recoveryCode: codes[0])).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Enabling_2fa_needs_the_login_password_so_a_stolen_session_cant_lock_the_owner_out()
    {
        var client = await Host.SignedInAsync(consent: false);
        var key = (await (await client.Post("/api/me/2fa/setup")).ExpectJson()).GetProperty("sharedKey").GetString()!;

        await (await client.Post("/api/me/2fa/enable", new { code = Totp.Code(key) })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        await (await client.Post("/api/me/2fa/enable", new { code = Totp.Code(key), password = "not-the-password-1" }))
            .ExpectProblem(HttpStatusCode.BadRequest, "validation");

        (await State(client)).GetProperty("enabled").GetBoolean().Should().BeFalse();
    }

    [DockerFact]
    public async Task Discord_sign_in_with_2fa_stops_at_the_code_step_and_completes_with_a_code()
    {
        var discordId = ApiHost.NewDiscordId();
        var owner = Host.NewClient();
        await Host.DiscordAsync(owner, DiscordLogin, discordId);
        await owner.RefreshCsrfAsync();
        var setup = await (await owner.Post("/api/me/2fa/setup")).ExpectJson();
        setup.GetProperty("authenticatorUri").GetString().Should().StartWith("otpauth://totp/Ember%3AEmber%20account?");
        var key = setup.GetProperty("sharedKey").GetString()!;
        await (await owner.Post("/api/me/2fa/enable", new { code = Totp.Code(key), password = ApiClient.Passphrase })).Expect(HttpStatusCode.OK);

        var client = Host.NewClient();
        (await Detail(await client.Post("/api/auth/discord/2fa", new { code = Totp.Code(key) }))).Should().Be("Failed");
        (await Host.DiscordAsync(client, DiscordLogin + "?returnUrl=/habits", discordId)).Should().Be("/login?step=2fa&returnUrl=%2Fhabits");
        await (await client.Get("/api/me")).Expect(HttpStatusCode.Unauthorized);

        (await Detail(await client.Post("/api/auth/discord/2fa", new { code = Totp.Code(key, 10) }))).Should().Be("Failed");
        (await Detail(await client.Post("/api/auth/discord/2fa", new { }))).Should().Be("Failed");
        await (await client.Post("/api/auth/discord/2fa", new { code = Totp.Code(key) })).Expect(HttpStatusCode.NoContent);

        await (await client.Get("/api/me")).Expect(HttpStatusCode.OK);
        (await Host.DiscordAsync(Host.NewClient(), DiscordLogin, discordId)).Should().Be("/login?step=2fa&returnUrl=%2Ftoday");
    }

    [DockerFact]
    public async Task A_discord_only_account_disables_2fa_with_a_current_code()
    {
        var discordId = ApiHost.NewDiscordId();
        var client = Host.NewClient();
        await Host.DiscordAsync(client, DiscordLogin, discordId);
        await client.RefreshCsrfAsync();
        var (key, _) = await EnableAsync(client);

        var wrong = await (await client.Post("/api/me/2fa/disable", new { code = Totp.Code(key, 10) })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        wrong.GetProperty("errors").Has("code").Should().BeTrue();
        await (await client.Post("/api/me/2fa/disable", new { code = Totp.Code(key) })).Expect(HttpStatusCode.NoContent);

        (await Host.DiscordAsync(Host.NewClient(), DiscordLogin, discordId)).Should().Be("/today");
    }

    [DockerFact]
    public async Task Disabling_while_2fa_is_off_changes_nothing_and_ends_no_session()
    {
        var discordId = ApiHost.NewDiscordId();
        var client = Host.NewClient();
        await Host.DiscordAsync(client, DiscordLogin, discordId);
        await client.RefreshCsrfAsync();
        var other = Host.NewClient();
        await Host.DiscordAsync(other, DiscordLogin, discordId);

        await (await client.Post("/api/me/2fa/disable", new { })).Expect(HttpStatusCode.NoContent);

        await (await other.Get("/api/me")).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Wrong_codes_lock_a_discord_only_account_out_of_the_code_step()
    {
        var discordId = ApiHost.NewDiscordId();
        var owner = Host.NewClient();
        await Host.DiscordAsync(owner, DiscordLogin, discordId);
        await owner.RefreshCsrfAsync();
        var (key, codes) = await EnableAsync(owner);
        var client = Host.NewClient();
        await Host.DiscordAsync(client, DiscordLogin, discordId);

        for (var i = 0; i < 4; i++)
            (await Detail(await client.Post("/api/auth/discord/2fa", new { code = Totp.Code(key, 10) }))).Should().Be("Failed");
        (await Detail(await client.Post("/api/auth/discord/2fa", new { recoveryCode = "not-a-code" }))).Should().Be("Failed");

        (await Detail(await client.Post("/api/auth/discord/2fa", new { code = Totp.Code(key) }))).Should().Be("Failed");
        (await Detail(await client.Post("/api/auth/discord/2fa", new { recoveryCode = codes[0] }))).Should().Be("Failed");
    }
}
