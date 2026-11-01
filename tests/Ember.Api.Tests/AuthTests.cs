using System.Net;
using System.Net.Http.Headers;
using FluentAssertions;
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
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        await (await client.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        await Host.Mail.WaitForAsync(email, 1);

        await (await client.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);

        var mails = await Host.Mail.WaitForAsync(email, 2);
        mails.Should().HaveCount(2);
        mails[1].Body.Should().Contain($"{ApiHost.WebOrigin}/forgot-password").And.NotContain("confirm-email");
        (await Host.Db(db => db.Users.CountAsync(u => u.NormalizedEmail == email.ToUpperInvariant()))).Should().Be(1);
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
    public async Task Five_wrong_passwords_lock_the_account_out_even_for_the_right_password()
    {
        var client = await Host.ConfirmedUserAsync();

        for (var i = 0; i < 5; i++)
            (await client.Post(LoginUrl, new Credentials(client.Email, "wrong-passphrase-1"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var problem = await (await client.Post(LoginUrl, new Credentials(client.Email, ApiClient.Passphrase))).ExpectProblem(HttpStatusCode.Unauthorized);
        problem.GetProperty("detail").GetString().Should().Be("LockedOut");
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
    public async Task Forgot_password_for_an_unknown_email_answers_200_and_sends_nothing()
    {
        var email = ApiHost.NewEmail();

        await (await Host.NewClient().Post("/api/auth/forgotPassword", new { email })).Expect(HttpStatusCode.OK);

        (await Host.Mail.SettledAsync(email)).Should().BeEmpty();
    }
}
