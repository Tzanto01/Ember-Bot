using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

public sealed record CodeRequest(string? Email, string? Code, string? SignupKey, string? Password, string? UserId);

/// <summary><c>POST /api/auth/confirm-email-code</c>: the emailed sign-up code confirms the email and signs in.</summary>
[Collection("Postgres")]
public class SignupCodeTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string CookieUrl = "/api/auth/confirm-email-code?useCookies=true";
    private const string BearerUrl = "/api/auth/confirm-email-code";
    private const string Detail = "That code didn't work. Check the newest email or send a new code.";
    private const string Victim = "victim-long-passphrase";
    private const string Attacker = "attacker-long-passphrase";
    private const string Wrong = "wrong-long-passphrase";

    private static string NewKey() => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    private static CodeRequest Body(string? email, string? code, string? key = null, string? pass = null, string? userId = null)
        => new(email, code, key, pass, userId);

    /// <summary>A client that sends <paramref name="key"/> as its sign-up key on every request, like a device that signed up.</summary>
    private ApiClient Device(string? key)
    {
        var client = Host.NewClient();
        if (key is not null) client.Http.DefaultRequestHeaders.Add("X-Ember-Signup-Key", key);
        return client;
    }

    private async Task<string> RegisterAsync(ApiClient client, string email, string pass = ApiClient.Passphrase, int mailCount = 1)
    {
        await (await client.Post("/api/auth/register", new Credentials(email, pass))).Expect(HttpStatusCode.OK);
        var mails = await Host.Mail.WaitForAsync(email, mailCount);
        mails.Should().HaveCount(mailCount);
        return ApiHost.SignupCode(mails[^1]);
    }

    private async Task<string> ResendAsync(ApiClient client, string email, int mailCount)
    {
        await (await client.Post("/api/auth/resendConfirmationEmail", new { email })).Expect(HttpStatusCode.OK);
        return ApiHost.SignupCode((await Host.Mail.WaitForAsync(email, mailCount))[mailCount - 1]);
    }

    private static string WrongCode(string code)
        => ((int.Parse(code, CultureInfo.InvariantCulture) + 1) % 1_000_000).ToString("D6", CultureInfo.InvariantCulture);

    private Task<bool> IsConfirmed(string email)
        => Host.Db(db => db.Users.Where(u => u.NormalizedEmail == email.ToUpperInvariant()).Select(u => u.EmailConfirmed).SingleAsync());

    private static async Task<JsonElement> ExpectInvalid(HttpResponseMessage response)
    {
        var problem = await response.ExpectProblem(HttpStatusCode.Unauthorized, "invalid_code");
        problem.GetProperty("detail").GetString().Should().Be(Detail);
        response.Headers.Contains("Set-Cookie").Should().BeFalse();
        return problem;
    }

    private static async Task ExpectPasswordRequired(HttpResponseMessage response)
    {
        var problem = await response.ExpectProblem(HttpStatusCode.Unauthorized, "password_required");
        problem.GetProperty("detail").GetString().Should().Be("Enter your password to finish on this device.");
        response.Headers.Contains("Set-Cookie").Should().BeFalse();
    }

    private static string Shape(JsonElement problem)
        => string.Join(";", problem.EnumerateObject().Where(p => p.Name != "traceId").Select(p => $"{p.Name}={p.Value.GetRawText()}"));

    [DockerFact]
    public async Task The_code_from_the_link_on_the_signup_device_signs_in_with_a_persistent_cookie_and_confirms_the_email()
    {
        var key = NewKey();
        var client = Device(key);
        var email = ApiHost.NewEmail();
        await (await client.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        var mail = (await Host.Mail.WaitForAsync(email, 1)).Single();
        var userId = (await Host.Db(db => db.Users.SingleAsync(u => u.NormalizedEmail == email.ToUpperInvariant()))).Id;
        var code = ApiHost.SignupCode(mail);

        code.Should().MatchRegex(@"^\d{6}$");
        mail.Body.Should().Contain($"\n\n{code}\n\n");
        mail.Link().Should().Be($"{ApiHost.WebOrigin}/confirm-email?user={userId}&code={code}");

        var response = await client.Post(CookieUrl, Body(null, code, key, userId: userId.ToString()));

        await response.Expect(HttpStatusCode.OK);
        response.Headers.GetValues("Set-Cookie").Should().Contain(c => c.StartsWith(".AspNetCore.Identity.Application=") && c.Contains("expires="));
        (await IsConfirmed(email)).Should().BeTrue();
        (await Host.SessionIsLiveAsync(client)).Should().BeTrue();
        (await (await client.Get("/api/me")).ExpectJson()).GetProperty("email").GetString().Should().Be(email);
        await ExpectInvalid(await Host.NewClient().Post(CookieUrl, Body(null, code, key, userId: userId.ToString())));
    }

    [DockerFact]
    public async Task Without_cookies_the_code_returns_bearer_tokens_like_login()
    {
        var key = NewKey();
        var email = ApiHost.NewEmail();
        var code = await RegisterAsync(Device(key), email);

        var tokens = await (await Host.NewClient().Post(BearerUrl, Body(email, code, key))).ExpectJson();

        tokens.GetProperty("tokenType").GetString().Should().Be("Bearer");
        var app = Host.NewClient();
        app.Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());
        (await (await app.Get("/api/me")).ExpectJson()).GetProperty("emailConfirmed").GetBoolean().Should().BeTrue();
        await (await Host.NewClient().Post("/api/auth/refresh", new { refreshToken = tokens.GetProperty("refreshToken").GetString() })).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task On_another_device_the_code_needs_the_password_once()
    {
        var email = ApiHost.NewEmail();
        var code = await RegisterAsync(Device(NewKey()), email);
        var other = Host.NewClient();

        await ExpectPasswordRequired(await other.Post(CookieUrl, Body(email, code, NewKey())));
        await ExpectPasswordRequired(await other.Post(CookieUrl, Body(email, code)));
        (await IsConfirmed(email)).Should().BeFalse();

        await (await other.Post(CookieUrl, Body(email, code, pass: ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        (await IsConfirmed(email)).Should().BeTrue();
        (await Host.SessionIsLiveAsync(other)).Should().BeTrue();
    }

    [DockerFact]
    public async Task A_wrong_password_fails_like_a_wrong_code_and_spends_a_try()
    {
        var key = NewKey();
        var email = ApiHost.NewEmail();
        var code = await RegisterAsync(Device(key), email);
        var other = Host.NewClient();

        var wrongCode = await ExpectInvalid(await other.Post(CookieUrl, Body(email, WrongCode(code), pass: ApiClient.Passphrase)));
        await ExpectPasswordRequired(await other.Post(CookieUrl, Body(email, code)));
        for (var i = 0; i < 3; i++)
            Shape(await ExpectInvalid(await other.Post(CookieUrl, Body(email, code, pass: Wrong)))).Should().Be(Shape(wrongCode));

        await ExpectInvalid(await other.Post(CookieUrl, Body(email, code, key)));
        (await IsConfirmed(email)).Should().BeFalse();
    }

    [DockerFact]
    public async Task Five_wrong_tries_burn_the_code_even_for_the_right_one_until_a_new_code_is_sent()
    {
        var key = NewKey();
        var client = Device(key);
        var email = ApiHost.NewEmail();
        var code = await RegisterAsync(client, email);

        for (var i = 0; i < 5; i++)
            await ExpectInvalid(await client.Post(CookieUrl, Body(email, WrongCode(code), key)));

        await ExpectInvalid(await client.Post(CookieUrl, Body(email, code, key)));
        (await IsConfirmed(email)).Should().BeFalse();

        var fresh = await ResendAsync(client, email, 2);
        await (await client.Post(CookieUrl, Body(email, fresh, key))).Expect(HttpStatusCode.OK);
        (await IsConfirmed(email)).Should().BeTrue();
    }

    [DockerFact]
    public async Task A_code_works_for_15_minutes()
    {
        var key = NewKey();
        var early = ApiHost.NewEmail();
        var late = ApiHost.NewEmail();
        var earlyCode = await RegisterAsync(Device(key), early);
        var lateCode = await RegisterAsync(Device(key), late);

        Host.Time.Advance(TimeSpan.FromMinutes(15) - TimeSpan.FromSeconds(1));
        await (await Host.NewClient().Post(CookieUrl, Body(early, earlyCode, key))).Expect(HttpStatusCode.OK);

        Host.Time.Advance(TimeSpan.FromSeconds(1));
        await ExpectInvalid(await Host.NewClient().Post(CookieUrl, Body(late, lateCode, key)));
        (await IsConfirmed(late)).Should().BeFalse();
    }

    [DockerFact]
    public async Task A_confirmed_account_is_never_signed_in_by_its_code()
    {
        var owner = await Host.ConfirmedUserAsync();
        var code = ApiHost.SignupCode((await Host.Mail.WaitForAsync(owner.Email, 1)).Single());

        await ExpectInvalid(await owner.Post(CookieUrl, Body(owner.Email, code, pass: ApiClient.Passphrase)));
        await ExpectInvalid(await owner.Post(BearerUrl, Body(owner.Email, code, pass: ApiClient.Passphrase)));

        await (await owner.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
    }

    [DockerFact]
    public async Task An_unknown_account_gets_the_same_answer_as_a_wrong_code()
    {
        var key = NewKey();
        var client = Device(key);
        var email = ApiHost.NewEmail();
        var code = await RegisterAsync(client, email);

        var wrong = await ExpectInvalid(await client.Post(CookieUrl, Body(email, WrongCode(code), key)));
        var unknownEmail = await ExpectInvalid(await client.Post(CookieUrl, Body(ApiHost.NewEmail(), code, key)));
        var unknownUser = await ExpectInvalid(await client.Post(BearerUrl, Body(null, code, pass: ApiClient.Passphrase, userId: Guid.NewGuid().ToString())));
        var neither = await ExpectInvalid(await client.Post(CookieUrl, Body(null, code)));

        foreach (var problem in new[] { unknownEmail, unknownUser, neither })
            Shape(problem).Should().Be(Shape(wrong));
    }

    [DockerFact]
    public async Task A_new_code_from_the_signup_device_replaces_the_old_one_and_stays_passwordless_there()
    {
        var key = NewKey();
        var email = ApiHost.NewEmail();
        var old = await RegisterAsync(Device(key), email);

        var fresh = await ResendAsync(Device(key), email, 2);

        await ExpectInvalid(await Host.NewClient().Post(CookieUrl, Body(email, old, key)));
        await (await Host.NewClient().Post(CookieUrl, Body(email, fresh, key))).Expect(HttpStatusCode.OK);
        (await IsConfirmed(email)).Should().BeTrue();
    }

    [DockerFact]
    public async Task A_new_code_asked_for_from_another_device_needs_the_password_on_every_device()
    {
        var first = NewKey();
        var second = NewKey();
        var email = ApiHost.NewEmail();
        await RegisterAsync(Device(first), email);

        var fresh = await ResendAsync(Device(second), email, 2);

        await ExpectPasswordRequired(await Host.NewClient().Post(CookieUrl, Body(email, fresh, second)));
        await ExpectPasswordRequired(await Host.NewClient().Post(CookieUrl, Body(email, fresh, first)));
        await (await Host.NewClient().Post(CookieUrl, Body(email, fresh, second, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        (await IsConfirmed(email)).Should().BeTrue();
    }

    [DockerFact]
    public async Task After_an_attacker_re_registers_a_resend_from_the_victims_device_never_signs_the_victim_into_it()
    {
        var email = ApiHost.NewEmail();
        var victimKey = NewKey();
        var victim = Device(victimKey);
        await RegisterAsync(victim, email, Victim);
        await RegisterAsync(Device(NewKey()), email, Attacker, mailCount: 2);

        var fresh = await ResendAsync(victim, email, 3);

        await ExpectPasswordRequired(await victim.Post(CookieUrl, Body(email, fresh, victimKey)));
        await ExpectInvalid(await victim.Post(CookieUrl, Body(email, fresh, victimKey, Victim)));
        (await IsConfirmed(email)).Should().BeFalse();
        await (await victim.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
    }

    [DockerFact]
    public async Task A_locked_out_account_is_not_signed_in_by_its_code()
    {
        var email = ApiHost.NewEmail();
        var key = NewKey();
        var code = await RegisterAsync(Device(key), email);
        await Host.Db(db => db.Users.Where(u => u.NormalizedEmail == email.ToUpperInvariant())
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.LockoutEnd, DateTimeOffset.UtcNow.AddYears(1))));

        await ExpectInvalid(await Host.NewClient().Post(CookieUrl, Body(email, code, key)));
        (await IsConfirmed(email)).Should().BeFalse();
    }

    [DockerFact]
    public async Task A_pre_registered_account_never_signs_in_the_email_owner_without_the_attackers_password()
    {
        var email = ApiHost.NewEmail();
        var code = await RegisterAsync(Device(NewKey()), email, Attacker);
        var victim = Device(NewKey());

        await ExpectPasswordRequired(await victim.Post(CookieUrl, Body(email, code)));
        await ExpectPasswordRequired(await victim.Post(CookieUrl, Body(email, code, NewKey())));
        await ExpectInvalid(await victim.Post(CookieUrl, Body(email, code, pass: Victim)));

        (await IsConfirmed(email)).Should().BeFalse();
        await (await victim.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
    }

    [DockerFact]
    public async Task When_the_attacker_registers_after_the_victim_the_victims_device_and_password_cannot_use_the_attackers_code()
    {
        var email = ApiHost.NewEmail();
        var victimKey = NewKey();
        var victim = Device(victimKey);
        await RegisterAsync(victim, email, Victim);
        var newest = await RegisterAsync(Device(NewKey()), email, Attacker, mailCount: 2);

        await ExpectPasswordRequired(await victim.Post(CookieUrl, Body(email, newest, victimKey)));
        await ExpectInvalid(await victim.Post(CookieUrl, Body(email, newest, victimKey, Victim)));

        (await IsConfirmed(email)).Should().BeFalse();
        await (await victim.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
    }
}
