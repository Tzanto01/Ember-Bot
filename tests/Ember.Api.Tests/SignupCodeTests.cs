using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

/// <summary><c>POST /api/auth/confirm-email-code</c>: the emailed sign-up code confirms the email and signs in.</summary>
[Collection("Postgres")]
public class SignupCodeTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string CookieUrl = "/api/auth/confirm-email-code?useCookies=true";
    private const string BearerUrl = "/api/auth/confirm-email-code";
    private const string Detail = "That code didn't work. Check the newest email or send a new code.";

    private async Task<SentMail> RegisterAsync(ApiClient client, string email)
    {
        await (await client.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        return (await Host.Mail.WaitForAsync(email, 1)).Single();
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

    [DockerFact]
    public async Task The_mailed_code_from_the_link_signs_in_with_a_persistent_cookie_and_confirms_the_email()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        var mail = await RegisterAsync(client, email);
        var userId = (await Host.Db(db => db.Users.SingleAsync(u => u.NormalizedEmail == email.ToUpperInvariant()))).Id;
        var code = ApiHost.SignupCode(mail);

        code.Should().MatchRegex(@"^\d{6}$");
        mail.Body.Should().Contain($"\n\n{code}\n\n");
        mail.Link().Should().Be($"{ApiHost.WebOrigin}/confirm-email?user={userId}&code={code}");

        var response = await client.Post(CookieUrl, new { userId = userId.ToString(), code });

        await response.Expect(HttpStatusCode.OK);
        response.Headers.GetValues("Set-Cookie").Should().Contain(c => c.StartsWith(".AspNetCore.Identity.Application=") && c.Contains("expires="));
        (await IsConfirmed(email)).Should().BeTrue();
        (await Host.SessionIsLiveAsync(client)).Should().BeTrue();
        (await (await client.Get("/api/me")).ExpectJson()).GetProperty("email").GetString().Should().Be(email);
        await ExpectInvalid(await Host.NewClient().Post(CookieUrl, new { userId = userId.ToString(), code }));
    }

    [DockerFact]
    public async Task Without_cookies_the_code_and_email_return_bearer_tokens_like_login()
    {
        var email = ApiHost.NewEmail();
        var mail = await RegisterAsync(Host.NewClient(), email);

        var tokens = await (await Host.NewClient().Post(BearerUrl, new { email, code = ApiHost.SignupCode(mail) })).ExpectJson();

        tokens.GetProperty("tokenType").GetString().Should().Be("Bearer");
        tokens.GetProperty("refreshToken").GetString().Should().NotBeNullOrEmpty();
        var app = Host.NewClient();
        app.Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());
        (await (await app.Get("/api/me")).ExpectJson()).GetProperty("emailConfirmed").GetBoolean().Should().BeTrue();
        await (await Host.NewClient().Post("/api/auth/refresh", new { refreshToken = tokens.GetProperty("refreshToken").GetString() })).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Five_wrong_tries_burn_the_code_even_for_the_right_one_until_a_new_code_is_sent()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        var code = ApiHost.SignupCode(await RegisterAsync(client, email));

        for (var i = 0; i < 5; i++)
            await ExpectInvalid(await client.Post(CookieUrl, new { email, code = WrongCode(code) }));

        await ExpectInvalid(await client.Post(CookieUrl, new { email, code }));
        (await IsConfirmed(email)).Should().BeFalse();

        await (await client.Post("/api/auth/resendConfirmationEmail", new { email })).Expect(HttpStatusCode.OK);
        var fresh = ApiHost.SignupCode((await Host.Mail.WaitForAsync(email, 2))[1]);
        await (await client.Post(CookieUrl, new { email, code = fresh })).Expect(HttpStatusCode.OK);
        (await IsConfirmed(email)).Should().BeTrue();
    }

    [DockerFact]
    public async Task A_code_works_for_15_minutes()
    {
        var early = ApiHost.NewEmail();
        var late = ApiHost.NewEmail();
        var earlyCode = ApiHost.SignupCode(await RegisterAsync(Host.NewClient(), early));
        var lateCode = ApiHost.SignupCode(await RegisterAsync(Host.NewClient(), late));

        Host.Time.Advance(TimeSpan.FromMinutes(15) - TimeSpan.FromSeconds(1));
        await (await Host.NewClient().Post(CookieUrl, new { email = early, code = earlyCode })).Expect(HttpStatusCode.OK);

        Host.Time.Advance(TimeSpan.FromSeconds(1));
        await ExpectInvalid(await Host.NewClient().Post(CookieUrl, new { email = late, code = lateCode }));
        (await IsConfirmed(late)).Should().BeFalse();
    }

    [DockerFact]
    public async Task A_confirmed_account_is_never_signed_in_by_its_code()
    {
        var owner = await Host.ConfirmedUserAsync();
        var code = ApiHost.SignupCode((await Host.Mail.WaitForAsync(owner.Email, 1)).Single());

        await ExpectInvalid(await owner.Post(CookieUrl, new { email = owner.Email, code }));
        await ExpectInvalid(await owner.Post(BearerUrl, new { email = owner.Email, code }));

        await (await owner.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
    }

    [DockerFact]
    public async Task An_unknown_account_gets_the_same_answer_as_a_wrong_code()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        var code = ApiHost.SignupCode(await RegisterAsync(client, email));

        var wrong = await ExpectInvalid(await client.Post(CookieUrl, new { email, code = WrongCode(code) }));
        var unknownEmail = await ExpectInvalid(await client.Post(CookieUrl, new { email = ApiHost.NewEmail(), code }));
        var unknownUser = await ExpectInvalid(await client.Post(BearerUrl, new { userId = Guid.NewGuid().ToString(), code }));
        var neither = await ExpectInvalid(await client.Post(CookieUrl, new { code }));

        foreach (var problem in new[] { unknownEmail, unknownUser, neither })
            Shape(problem).Should().Be(Shape(wrong));
    }

    private static string Shape(JsonElement problem)
    {
        var fields = problem.EnumerateObject().Where(p => p.Name != "traceId").Select(p => $"{p.Name}={p.Value.GetRawText()}");
        return string.Join(";", fields);
    }

    [DockerFact]
    public async Task Sending_a_new_code_replaces_the_old_one()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        var old = ApiHost.SignupCode(await RegisterAsync(client, email));

        await (await client.Post("/api/auth/resendConfirmationEmail", new { email })).Expect(HttpStatusCode.OK);
        var fresh = ApiHost.SignupCode((await Host.Mail.WaitForAsync(email, 2))[1]);

        await ExpectInvalid(await client.Post(CookieUrl, new { email, code = old }));
        await (await client.Post(CookieUrl, new { email, code = fresh })).Expect(HttpStatusCode.OK);
        (await IsConfirmed(email)).Should().BeTrue();
    }
}
