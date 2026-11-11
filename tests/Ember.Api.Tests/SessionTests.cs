using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class SessionTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string CookieName = ".AspNetCore.Identity.Application";

    private async Task<ApiClient> SecondDeviceAsync(ApiClient first)
    {
        var second = Host.NewClient();
        second.Email = first.Email;
        await second.LoginAsync();
        return second;
    }

    private async Task<JsonElement> BearerTokensAsync(ApiClient user)
        => await (await Host.NewClient().Post("/api/auth/login", new Credentials(user.Email, ApiClient.Passphrase))).ExpectJson();

    private Task<HttpResponseMessage> RefreshAsync(JsonElement tokens)
        => Host.NewClient().Post("/api/auth/refresh", new { refreshToken = tokens.GetProperty("refreshToken").GetString() });

    private ApiClient BearerClient(JsonElement tokens)
    {
        var client = Host.NewClient();
        client.Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());
        return client;
    }

    [DockerFact]
    public async Task Logout_on_one_device_leaves_the_others_signed_in()
    {
        var a = await Host.SignedInAsync(consent: false);
        var b = await SecondDeviceAsync(a);
        var tokens = await BearerTokensAsync(a);

        await (await a.Post("/api/auth/logout")).Expect(HttpStatusCode.NoContent);
        Host.Time.Advance(TimeSpan.FromMinutes(6));

        await (await a.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
        await (await b.Get("/api/me")).Expect(HttpStatusCode.OK);
        await (await RefreshAsync(tokens)).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task A_copied_cookie_stops_working_as_soon_as_its_device_logs_out()
    {
        var a = await Host.SignedInAsync(consent: false);
        var copied = Host.NewClient();
        copied.AddCookie(CookieName, a.CookieValue(CookieName)!, "/");
        await (await copied.Get("/api/me")).Expect(HttpStatusCode.OK);

        await (await a.Post("/api/auth/logout")).Expect(HttpStatusCode.NoContent);

        await (await copied.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
    }

    [DockerFact]
    public async Task Logout_everywhere_ends_every_session_at_once()
    {
        var a = await Host.SignedInAsync(consent: false);
        var b = await SecondDeviceAsync(a);
        var tokens = await BearerTokensAsync(a);

        await (await a.Post("/api/auth/logout-everywhere")).Expect(HttpStatusCode.NoContent);

        await (await a.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
        await (await b.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
        await (await BearerClient(tokens).Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
        await (await RefreshAsync(tokens)).Expect(HttpStatusCode.Unauthorized);
    }

    [DockerFact]
    public async Task A_bearer_logout_ends_its_access_and_refresh_token()
    {
        var user = await Host.ConfirmedUserAsync();
        var tokens = await BearerTokensAsync(user);
        var app = BearerClient(tokens);
        await (await app.Get("/api/me")).Expect(HttpStatusCode.OK);

        await (await app.Post("/api/auth/logout")).Expect(HttpStatusCode.NoContent);

        await (await app.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
        await (await RefreshAsync(tokens)).Expect(HttpStatusCode.Unauthorized);
    }

    [DockerFact]
    public async Task A_password_reset_ends_the_other_sessions()
    {
        var a = await Host.SignedInAsync(consent: false);
        var tokens = await BearerTokensAsync(a);
        await (await Host.NewClient().Post("/api/auth/forgotPassword", new { email = a.Email })).Expect(HttpStatusCode.OK);
        var code = QueryHelpers.ParseQuery(new Uri((await Host.Mail.WaitForAsync(a.Email, 2))[1].Link()).Query)["code"].ToString();

        await (await Host.NewClient().Post("/api/auth/resetPassword", new ResetRequest(a.Email, code, "another-long-passphrase"))).Expect(HttpStatusCode.OK);

        await (await a.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
        await (await RefreshAsync(tokens)).Expect(HttpStatusCode.Unauthorized);
    }

    [DockerFact]
    public async Task A_cookie_issued_without_a_session_is_rejected()
    {
        var user = await Host.ConfirmedUserAsync();
        string legacy;
        using (var scope = Host.Services.CreateScope())
        {
            var account = (await scope.ServiceProvider.GetRequiredService<UserManager<User>>().FindByEmailAsync(user.Email))!;
            var principal = await scope.ServiceProvider.GetRequiredService<IUserClaimsPrincipalFactory<User>>().CreateAsync(account);
            var cookie = scope.ServiceProvider.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(IdentityConstants.ApplicationScheme);
            var now = Host.Time.GetUtcNow();
            legacy = cookie.TicketDataFormat.Protect(new AuthenticationTicket(principal,
                new AuthenticationProperties { IssuedUtc = now, ExpiresUtc = now.AddDays(14) }, IdentityConstants.ApplicationScheme));
        }
        var client = Host.NewClient();
        client.AddCookie(CookieName, legacy, "/");

        await (await client.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
    }
}
