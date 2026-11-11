using System.Net;
using System.Net.Http.Headers;
using FluentAssertions;
using Ember.Core.Models;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class AuthTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string LoginUrl = "/api/auth/login?useCookies=true";

    [DockerFact]
    public async Task Register_mails_a_confirmation_link_on_the_configured_web_origin()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();

        await (await client.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);

        var mails = await Host.Mail.WaitForAsync(email, 1);
        mails.Should().HaveCount(1);
        mails[0].Link().Should().StartWith($"{ApiHost.WebOrigin}/confirm-email?userId=").And.Contain("&code=");
    }

    [DockerFact]
    public async Task Register_with_a_taken_email_answers_like_a_new_one_mails_the_owner_and_creates_no_second_account()
    {
        var client = await Host.ConfirmedUserAsync();
        var email = client.Email;

        await (await client.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);

        var mails = await Host.Mail.WaitForAsync(email, 2);
        mails.Should().HaveCount(2);
        mails[1].Body.Should().Contain($"{ApiHost.WebOrigin}/forgot-password").And.NotContain("confirm-email");
        (await Host.Db(db => db.Users.CountAsync(u => u.NormalizedEmail == email.ToUpperInvariant()))).Should().Be(1);
    }

    [DockerFact]
    public async Task Registering_again_with_an_unconfirmed_email_replaces_the_account_so_only_the_second_password_and_link_work()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        const string first = "first-long-passphrase";
        const string second = "second-long-passphrase";
        await (await client.Post("/api/auth/register", new Credentials(email, first))).Expect(HttpStatusCode.OK);
        await Host.Mail.WaitForAsync(email, 1);
        await (await client.Post("/api/auth/register", new Credentials(email, second))).Expect(HttpStatusCode.OK);
        var mails = await Host.Mail.WaitForAsync(email, 2);
        mails.Should().HaveCount(2);

        (await Host.OpenConfirmLinkAsync(client, mails[0], first)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        await (await Host.OpenConfirmLinkAsync(client, mails[1], second)).Expect(HttpStatusCode.OK);

        (await client.Post(LoginUrl, new Credentials(email, first))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        await (await client.Post(LoginUrl, new Credentials(email, second))).Expect(HttpStatusCode.OK);
        (await Host.Db(db => db.Users.CountAsync(u => u.NormalizedEmail == email.ToUpperInvariant()))).Should().Be(1);
    }

    [DockerFact]
    public async Task Login_failures_reveal_nothing_about_the_account_until_the_password_matched()
    {
        var client = Host.NewClient();
        var unconfirmed = ApiHost.NewEmail();
        await (await client.Post("/api/auth/register", new Credentials(unconfirmed, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        var discordId = ApiHost.NewDiscordId();
        await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(discordId));
        const string wrong = "wrong-passphrase-1";

        var attempts = new[]
        {
            new Credentials(ApiHost.NewEmail(), wrong),
            new Credentials(DiscordLogin.UserName(discordId), wrong),
            new Credentials(DiscordLogin.UserName(discordId), ApiClient.Passphrase),
            new Credentials(unconfirmed, wrong),
        };
        foreach (var attempt in attempts)
        {
            var problem = await (await client.Post(LoginUrl, attempt)).ExpectProblem(HttpStatusCode.Unauthorized);
            problem.GetProperty("detail").GetString().Should().Be("Failed", "login as {0}", attempt.Email);
        }

        var notAllowed = await (await client.Post(LoginUrl, new Credentials(unconfirmed, ApiClient.Passphrase))).ExpectProblem(HttpStatusCode.Unauthorized);
        notAllowed.GetProperty("detail").GetString().Should().Be("NotAllowed");
    }

    [DockerFact]
    public async Task Anonymous_logout_is_a_204_that_sets_no_cookie()
    {
        var response = await Host.NewClient().Post("/api/auth/logout");

        await response.Expect(HttpStatusCode.NoContent);
        response.Headers.Contains("Set-Cookie").Should().BeFalse();
    }

    [DockerFact]
    public async Task Register_with_a_nine_character_password_is_a_validation_problem_and_creates_nothing()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();

        var problem = await (await client.Post("/api/auth/register", new Credentials(email, "123456789"))).ExpectProblem(HttpStatusCode.BadRequest);

        problem.GetProperty("errors").Has("PasswordTooShort").Should().BeTrue();
        (await Host.Mail.SettledAsync(email)).Should().BeEmpty();
        (await Host.Db(db => db.Users.CountAsync(u => u.NormalizedEmail == email.ToUpperInvariant()))).Should().Be(0);
    }

    [DockerFact]
    public async Task Login_before_confirming_the_email_is_rejected_as_not_allowed()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        await (await client.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);

        var problem = await (await client.Post(LoginUrl, new Credentials(email, ApiClient.Passphrase))).ExpectProblem(HttpStatusCode.Unauthorized);

        problem.GetProperty("detail").GetString().Should().Be("NotAllowed");
        (await client.Get("/api/me")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [DockerFact]
    public async Task Cookie_login_signs_the_client_in()
    {
        var client = await Host.ConfirmedUserAsync();

        await client.LoginAsync();

        var me = await (await client.Get("/api/me")).ExpectJson();
        me.GetProperty("email").GetString().Should().Be(client.Email);
        me.GetProperty("emailConfirmed").GetBoolean().Should().BeTrue();
        me.GetProperty("hasPassword").GetBoolean().Should().BeTrue();
    }

    [DockerFact]
    public async Task Bearer_login_returns_tokens_that_authenticate_without_a_cookie()
    {
        var user = await Host.ConfirmedUserAsync();

        var tokens = await (await user.Post("/api/auth/login", new Credentials(user.Email, ApiClient.Passphrase))).ExpectJson();

        tokens.GetProperty("accessToken").GetString().Should().NotBeNullOrEmpty();
        tokens.GetProperty("refreshToken").GetString().Should().NotBeNullOrEmpty();
        var bearer = Host.NewClient();
        bearer.Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());
        var me = await (await bearer.Get("/api/me")).ExpectJson();
        me.GetProperty("email").GetString().Should().Be(user.Email);
    }

    [DockerFact]
    public async Task Five_wrong_passwords_lock_the_account_and_a_locked_account_never_confirms_the_password()
    {
        var client = await Host.ConfirmedUserAsync();

        for (var i = 0; i < 5; i++)
            (await client.Post(LoginUrl, new Credentials(client.Email, "wrong-passphrase-1"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var problem = await (await client.Post(LoginUrl, new Credentials(client.Email, ApiClient.Passphrase))).ExpectProblem(HttpStatusCode.Unauthorized);
        problem.GetProperty("detail").GetString().Should().Be("Failed");
        var stillWrong = await (await client.Post(LoginUrl, new Credentials(client.Email, "wrong-passphrase-1"))).ExpectProblem(HttpStatusCode.Unauthorized);
        stillWrong.GetProperty("detail").GetString().Should().Be("Failed");
    }

    [DockerFact]
    public async Task Logout_ends_the_session_and_later_requests_get_a_401_problem_not_a_redirect()
    {
        var client = await Host.SignedInAsync(consent: false);
        (await client.Get("/api/me")).StatusCode.Should().Be(HttpStatusCode.OK);

        await (await client.Post("/api/auth/logout")).Expect(HttpStatusCode.NoContent);

        await (await client.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
        await (await Host.NewClient().Get("/api/habits")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
    }

    [DockerFact]
    public async Task Logout_ends_the_accounts_other_sessions_on_the_server()
    {
        var client = await Host.SignedInAsync(consent: false);
        const string cookieName = ".AspNetCore.Identity.Application";
        var copied = Host.NewClient();
        copied.AddCookie(cookieName, client.CookieValue(cookieName)!, "/");
        var tokens = await (await Host.NewClient().Post("/api/auth/login", new Credentials(client.Email, ApiClient.Passphrase))).ExpectJson();
        await (await copied.Get("/api/me")).Expect(HttpStatusCode.OK);

        await (await client.Post("/api/auth/logout")).Expect(HttpStatusCode.NoContent);
        Host.Time.Advance(TimeSpan.FromSeconds(61));

        await (await copied.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
        await (await Host.NewClient().Post("/api/auth/refresh", new { refreshToken = tokens.GetProperty("refreshToken").GetString() }))
            .Expect(HttpStatusCode.Unauthorized);
    }

    [DockerFact]
    public async Task Password_reset_mails_a_web_link_and_the_new_password_replaces_the_old_one()
    {
        var client = await Host.ConfirmedUserAsync();
        const string newPassphrase = "another-long-passphrase";

        await (await client.Post("/api/auth/forgotPassword", new { email = client.Email })).Expect(HttpStatusCode.OK);

        var mails = await Host.Mail.WaitForAsync(client.Email, 2);
        mails.Should().HaveCount(2);
        mails[1].Link().Should().StartWith($"{ApiHost.WebOrigin}/reset-password?email=");
        var query = QueryHelpers.ParseQuery(new Uri(mails[1].Link()).Query);
        query["email"].ToString().Should().Be(client.Email);

        await (await client.Post("/api/auth/resetPassword", new ResetRequest(client.Email, query["code"].ToString(), newPassphrase))).Expect(HttpStatusCode.OK);

        (await client.Post(LoginUrl, new Credentials(client.Email, ApiClient.Passphrase))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        await (await client.Post(LoginUrl, new Credentials(client.Email, newPassphrase))).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task A_password_reset_lifts_the_lockout_so_the_new_password_signs_in_at_once()
    {
        var client = await Host.ConfirmedUserAsync();
        const string newPassphrase = "another-long-passphrase";
        for (var i = 0; i < 5; i++)
            (await client.Post(LoginUrl, new Credentials(client.Email, "wrong-passphrase-1"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        await (await client.Post("/api/auth/forgotPassword", new { email = client.Email })).Expect(HttpStatusCode.OK);
        var code = QueryHelpers.ParseQuery(new Uri((await Host.Mail.WaitForAsync(client.Email, 2))[1].Link()).Query)["code"].ToString();
        await (await client.Post("/api/auth/resetPassword", new ResetRequest(client.Email, code, newPassphrase))).Expect(HttpStatusCode.OK);

        await (await client.Post(LoginUrl, new Credentials(client.Email, newPassphrase))).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Reset_password_failures_are_400_with_the_same_invalid_token_shape_for_unknown_emails_and_bad_codes()
    {
        var client = await Host.ConfirmedUserAsync();
        await (await client.Post("/api/auth/forgotPassword", new { email = client.Email })).Expect(HttpStatusCode.OK);
        var resetMail = (await Host.Mail.WaitForAsync(client.Email, 2))[^1];
        var code = QueryHelpers.ParseQuery(new Uri(resetMail.Link()).Query)["code"].ToString();
        const string newPassphrase = "another-long-passphrase";
        static string[] ErrorKeys(System.Text.Json.JsonElement problem) => problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).ToArray();

        var unknownEmail = await (await client.Post("/api/auth/resetPassword", new ResetRequest(ApiHost.NewEmail(), code, newPassphrase)))
            .ExpectProblem(HttpStatusCode.BadRequest);
        var badCode = await (await client.Post("/api/auth/resetPassword", new ResetRequest(client.Email, "AAAA", newPassphrase)))
            .ExpectProblem(HttpStatusCode.BadRequest);
        var tooShort = await (await client.Post("/api/auth/resetPassword", new ResetRequest(client.Email, code, "123456789")))
            .ExpectProblem(HttpStatusCode.BadRequest);

        ErrorKeys(unknownEmail).Should().Equal("InvalidToken");
        ErrorKeys(badCode).Should().Equal(ErrorKeys(unknownEmail));
        ErrorKeys(tooShort).Should().Contain("PasswordTooShort");
        await (await client.Post(LoginUrl, new Credentials(client.Email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Forgot_password_for_an_unknown_email_answers_200_and_sends_nothing()
    {
        var email = ApiHost.NewEmail();

        await (await Host.NewClient().Post("/api/auth/forgotPassword", new { email })).Expect(HttpStatusCode.OK);

        (await Host.Mail.SettledAsync(email)).Should().BeEmpty();
    }
}
