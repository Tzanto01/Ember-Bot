using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class ConfirmEmailTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string LoginUrl = "/api/auth/login?useCookies=true";
    private const string Wrong = "wrong-passphrase-1";
    private const string Victim = "victim-long-passphrase";
    private const string Attacker = "attacker-long-passphrase";

    private static (string? Type, string? Detail, string? Title) Shape(JsonElement problem) =>
    (
        problem.GetProperty("type").GetString(),
        problem.TryGetProperty("detail", out var detail) ? detail.GetString() : null,
        problem.TryGetProperty("title", out var title) ? title.GetString() : null
    );

    private async Task<SentMail> RegisterAsync(ApiClient client, string email, string passphrase, int mailCount)
    {
        await (await client.Post("/api/auth/register", new Credentials(email, passphrase))).Expect(HttpStatusCode.OK);
        var mails = await Host.Mail.WaitForAsync(email, mailCount);
        mails.Should().HaveCount(mailCount);
        return mails[^1];
    }

    private Task<bool> IsConfirmed(string email)
        => Host.Db(db => db.Users.Where(u => u.NormalizedEmail == email.ToUpperInvariant()).Select(u => u.EmailConfirmed).SingleAsync());

    [DockerFact]
    public async Task Confirming_with_a_wrong_code_a_wrong_password_or_an_unknown_user_fails_identically_and_confirms_nothing()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        var mail = await RegisterAsync(client, email, ApiClient.Passphrase, 1);
        var code = QueryHelpers.ParseQuery(new Uri(mail.Link()).Query)["code"].ToString();

        var wrongCode = await (await Host.OpenConfirmLinkAsync(client, mail, ApiClient.Passphrase, code: "AAAA")).ExpectProblem(HttpStatusCode.Unauthorized);
        var wrongPassword = await (await Host.OpenConfirmLinkAsync(client, mail, Wrong)).ExpectProblem(HttpStatusCode.Unauthorized);
        var unknownUser = await (await client.Post("/api/auth/confirmEmail", new ConfirmRequest(Guid.NewGuid().ToString(), code, ApiClient.Passphrase)))
            .ExpectProblem(HttpStatusCode.Unauthorized);

        Shape(wrongPassword).Should().Be(Shape(wrongCode));
        Shape(unknownUser).Should().Be(Shape(wrongCode));
        (await IsConfirmed(email)).Should().BeFalse();
        var login = await (await client.Post(LoginUrl, new Credentials(email, ApiClient.Passphrase))).ExpectProblem(HttpStatusCode.Unauthorized);
        login.GetProperty("detail").GetString().Should().Be("NotAllowed");
        await (await client.Get($"/api/auth/confirmEmail?userId={Guid.NewGuid()}&code={code}")).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await Host.OpenConfirmLinkAsync(client, mail, ApiClient.Passphrase)).Expect(HttpStatusCode.OK);
        (await IsConfirmed(email)).Should().BeTrue();
    }

    [DockerFact]
    public async Task A_trailing_slash_on_confirm_email_is_a_404_and_confirms_nothing()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        var mail = await RegisterAsync(client, email, ApiClient.Passphrase, 1);
        var link = await Host.OldConfirmLinkAsync(mail);

        var response = await client.Get($"/api/auth/confirmEmail/?userId={link.UserId}&code={Uri.EscapeDataString(link.Code)}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await IsConfirmed(email)).Should().BeFalse();
        var login = await (await client.Post(LoginUrl, new Credentials(email, ApiClient.Passphrase))).ExpectProblem(HttpStatusCode.Unauthorized);
        login.GetProperty("detail").GetString().Should().Be("NotAllowed");
    }

    [DockerFact]
    public async Task Registering_a_taken_confirmed_email_answers_the_same_with_or_without_a_trailing_slash()
    {
        var owner = await Host.ConfirmedUserAsync();
        var client = Host.NewClient();

        foreach (var path in new[] { "/api/auth/register/", "/api/auth/register" })
        {
            var body = await (await client.Post(path, new Credentials(owner.Email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
            body.Should().NotContain("Duplicate");
        }

        var mails = await Host.Mail.WaitForAsync(owner.Email, 3);
        mails.Should().HaveCount(3);
        mails.Skip(1).Should().OnlyContain(m => m.Body.Contains($"{ApiHost.WebOrigin}/forgot-password") && !m.Body.Contains("confirm-email"));
    }

    [DockerFact]
    public async Task Forgot_password_with_a_trailing_slash_still_mails_an_unconfirmed_account_the_reset_link()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        await RegisterAsync(client, email, ApiClient.Passphrase, 1);

        await (await client.Post("/api/auth/forgotPassword/", new { email })).Expect(HttpStatusCode.OK);

        var mails = await Host.Mail.WaitForAsync(email, 2);
        mails.Should().HaveCount(2);
        mails[1].Link().Should().StartWith($"{ApiHost.WebOrigin}/reset-password?email=");
    }

    [DockerFact]
    public async Task Five_failed_confirmations_lock_the_account_even_for_the_right_code_and_password()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        var mail = await RegisterAsync(client, email, ApiClient.Passphrase, 1);

        for (var i = 0; i < 5; i++)
            (await Host.OpenConfirmLinkAsync(client, mail, ApiClient.Passphrase, code: "AAAA")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        (await Host.OpenConfirmLinkAsync(client, mail, ApiClient.Passphrase)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await IsConfirmed(email)).Should().BeFalse();
        var login = await (await client.Post(LoginUrl, new Credentials(email, ApiClient.Passphrase))).ExpectProblem(HttpStatusCode.Unauthorized);
        login.GetProperty("detail").GetString().Should().Be("Failed");
    }

    [DockerFact]
    public async Task When_the_victim_registers_after_the_attacker_the_victims_password_is_the_one_that_confirms()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        await RegisterAsync(client, email, Attacker, 1);
        var victimMail = await RegisterAsync(client, email, Victim, 2);

        await (await Host.OpenConfirmLinkAsync(client, victimMail, Victim)).Expect(HttpStatusCode.OK);

        await (await client.Post(LoginUrl, new Credentials(email, Victim))).Expect(HttpStatusCode.OK);
        (await client.Post(LoginUrl, new Credentials(email, Attacker))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [DockerFact]
    public async Task When_the_attacker_registers_after_the_victim_the_victims_click_cannot_activate_the_attackers_password_and_a_reset_recovers_the_address()
    {
        var client = Host.NewClient();
        var email = ApiHost.NewEmail();
        const string recovered = "recovered-long-passphrase";
        await RegisterAsync(client, email, Victim, 1);
        var newestMail = await RegisterAsync(client, email, Attacker, 2);

        (await Host.OpenConfirmLinkAsync(client, newestMail, Victim)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        (await IsConfirmed(email)).Should().BeFalse();
        await (await client.Post("/api/auth/forgotPassword", new { email })).Expect(HttpStatusCode.OK);
        var resetMail = (await Host.Mail.WaitForAsync(email, 3))[^1];
        resetMail.Link().Should().StartWith($"{ApiHost.WebOrigin}/reset-password?email=");
        var resetCode = QueryHelpers.ParseQuery(new Uri(resetMail.Link()).Query)["code"].ToString();
        await (await client.Post("/api/auth/resetPassword", new ResetRequest(email, resetCode, recovered))).Expect(HttpStatusCode.OK);

        (await IsConfirmed(email)).Should().BeTrue();
        await (await client.Post(LoginUrl, new Credentials(email, recovered))).Expect(HttpStatusCode.OK);
        (await client.Post(LoginUrl, new Credentials(email, Attacker))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
