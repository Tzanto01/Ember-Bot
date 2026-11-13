using System.Net;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

/// <summary>A new account's language comes from the sign-up request's <c>language</c>, else its <c>Accept-Language</c>, and its emails use it.</summary>
[Collection("Postgres")]
public class LanguageSignupTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string DiscordLoginUrl = "/api/auth/discord/login";

    private ApiClient Client(string? acceptLanguage)
    {
        var client = Host.NewClient();
        if (acceptLanguage is not null) client.Http.DefaultRequestHeaders.Add("Accept-Language", acceptLanguage);
        return client;
    }

    private async Task<(ApiClient Client, string Email)> RegisterAsync(string? acceptLanguage)
    {
        var client = Client(acceptLanguage);
        var email = ApiHost.NewEmail();
        await (await client.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        return (client, email);
    }

    private Task<string> LanguageOf(string email)
        => Host.Db(db => db.Users.Where(u => u.NormalizedEmail == email.ToUpperInvariant()).Select(u => u.Language).SingleAsync());

    private Task<string> DiscordLanguageOf(ulong discordId)
        => Host.Db(db => db.Users.Where(u => u.UserName == DiscordLogin.UserName(discordId)).Select(u => u.Language).SingleAsync());

    [DockerFact]
    public async Task Email_sign_up_takes_the_first_supported_Accept_Language()
    {
        foreach (var (header, expected) in new (string?, string)[] { ("de-DE", "de"), ("en-US,de;q=0.5", "en"), ("fr-FR,de;q=0.8", "de"), (null, "en") })
        {
            var (_, email) = await RegisterAsync(header);
            (await LanguageOf(email)).Should().Be(expected, $"Accept-Language: {header ?? "(none)"}");
        }
    }

    [DockerFact]
    public async Task Email_sign_up_takes_a_valid_body_language_over_Accept_Language_and_falls_back_on_an_invalid_one()
    {
        foreach (var (language, header, expected) in new (object, string, string)[] { ("de", "en-US", "de"), ("en", "de-DE", "en"), ("fr", "de-DE", "de"), (42, "de", "de") })
        {
            var email = ApiHost.NewEmail();
            await (await Client(header).Post("/api/auth/register", new { email, password = ApiClient.Passphrase, language })).Expect(HttpStatusCode.OK);
            (await LanguageOf(email)).Should().Be(expected, $"language: {language}, Accept-Language: {header}");
        }

        var german = ApiHost.NewEmail();
        await (await Client("en").Post("/api/auth/register", new { email = german, password = ApiClient.Passphrase, language = "de" })).Expect(HttpStatusCode.OK);
        (await Host.Mail.WaitForAsync(german, 1)).Single().Subject.Should().Be("Bestätige deine E-Mail-Adresse für Ember");
    }

    [DockerFact]
    public async Task The_confirmation_mail_of_a_German_account_is_German_and_still_carries_the_code_and_link()
    {
        var (_, email) = await RegisterAsync("de-DE,de;q=0.9");

        var mail = (await Host.Mail.WaitForAsync(email, 1)).Single();
        var code = ApiHost.SignupCode(mail);

        mail.Subject.Should().Be("Bestätige deine E-Mail-Adresse für Ember");
        mail.Body.Should().StartWith("Willkommen bei Ember.").And.Contain("Dein Code:").And.Contain("Der Code gilt 15 Minuten.")
            .And.Contain($"\n\n{code}\n\n").And.Contain($"\n{mail.Link()}\n");
        mail.Link().Should().StartWith($"{ApiHost.WebOrigin}/confirm-email?user=");
    }

    [DockerFact]
    public async Task The_confirmation_mail_of_an_English_account_keeps_the_English_text()
    {
        var (_, email) = await RegisterAsync("en-GB");

        var mail = (await Host.Mail.WaitForAsync(email, 1)).Single();

        mail.Subject.Should().Be("Confirm your Ember email address");
        mail.Body.Should().Be(
            $"Welcome to Ember.\n\nYour code:\n\n{ApiHost.SignupCode(mail)}\n\nEnter it in Ember to confirm your email address and sign in, or open this link:\n{mail.Link()}\n\nThe code works for 15 minutes. If you didn't create an Ember account, you can ignore this email.");
    }

    [DockerFact]
    public async Task Password_reset_and_already_registered_mails_follow_the_account_language_not_the_request()
    {
        var (client, email) = await RegisterAsync("de");
        await (await Host.OpenConfirmLinkAsync(client, (await Host.Mail.WaitForAsync(email, 1)).Single(), ApiClient.Passphrase)).Expect(HttpStatusCode.OK);
        var english = Client("en-US");

        await (await english.Post("/api/auth/forgotPassword", new { email })).Expect(HttpStatusCode.OK);
        var reset = (await Host.Mail.WaitForAsync(email, 2))[1];
        reset.Subject.Should().Be("Setze dein Ember-Passwort zurück");
        reset.Body.Should().Contain("Wähle hier ein neues Passwort:").And.Contain($"\n{reset.Link()}\n");
        var query = QueryHelpers.ParseQuery(new Uri(reset.Link()).Query);
        await (await english.Post("/api/auth/resetPassword", new ResetRequest(email, query["code"].ToString(), "another-long-passphrase"))).Expect(HttpStatusCode.OK);

        await (await english.Post("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        var registered = (await Host.Mail.WaitForAsync(email, 3))[2];
        registered.Subject.Should().Be("Dein Ember-Konto");
        registered.Body.Should().Contain($"Anmelden: {ApiHost.WebOrigin}/login\nPasswort vergessen? {ApiHost.WebOrigin}/forgot-password");
        (await LanguageOf(email)).Should().Be("de");
    }

    [DockerFact]
    public async Task Discord_sign_in_creates_the_account_in_the_browser_language_and_a_later_sign_in_keeps_it()
    {
        var discordId = ApiHost.NewDiscordId();

        (await Host.DiscordAsync(Client("de-AT,en;q=0.5"), DiscordLoginUrl, discordId)).Should().Be("/today");
        (await DiscordLanguageOf(discordId)).Should().Be("de");

        await Host.DiscordAsync(Client("en-US"), DiscordLoginUrl, discordId);
        (await DiscordLanguageOf(discordId)).Should().Be("de");

        var english = ApiHost.NewDiscordId();
        await Host.DiscordAsync(Client(null), DiscordLoginUrl, english);
        (await DiscordLanguageOf(english)).Should().Be("en");
    }

    [DockerFact]
    public async Task Discord_sign_in_with_a_language_creates_the_account_in_it_over_Accept_Language_and_a_later_sign_in_keeps_it()
    {
        var discordId = ApiHost.NewDiscordId();

        (await Host.DiscordAsync(Client("en-US"), $"{DiscordLoginUrl}?language=de", discordId)).Should().Be("/today");
        (await DiscordLanguageOf(discordId)).Should().Be("de");

        await Host.DiscordAsync(Client("en-US"), $"{DiscordLoginUrl}?language=en", discordId);
        (await DiscordLanguageOf(discordId)).Should().Be("de");

        var invalid = ApiHost.NewDiscordId();
        await Host.DiscordAsync(Client("de"), $"{DiscordLoginUrl}?language=fr", invalid);
        (await DiscordLanguageOf(invalid)).Should().Be("de");
    }

    [DockerFact]
    public async Task Native_Discord_sign_in_with_a_language_creates_the_account_in_it()
    {
        var discordId = ApiHost.NewDiscordId();
        var challenge = WebEncoders.Base64UrlEncode(System.Security.Cryptography.SHA256.HashData("a-verifier-that-is-long-enough-for-pkce-43ch"u8));

        var target = await Host.DiscordAsync(Client("en"), $"{DiscordLoginUrl}?client=native&challenge={challenge}&language=de", discordId);

        target.Should().Contain("?code=");
        (await DiscordLanguageOf(discordId)).Should().Be("de");
    }

    [DockerFact]
    public async Task Native_Discord_sign_in_creates_the_account_in_the_browser_language()
    {
        var discordId = ApiHost.NewDiscordId();
        var challenge = WebEncoders.Base64UrlEncode(System.Security.Cryptography.SHA256.HashData("a-verifier-that-is-long-enough-for-pkce-43ch"u8));

        var target = await Host.DiscordAsync(Client("de"), $"{DiscordLoginUrl}?client=native&challenge={challenge}", discordId);

        target.Should().Contain("?code=");
        (await DiscordLanguageOf(discordId)).Should().Be("de");
    }
}
