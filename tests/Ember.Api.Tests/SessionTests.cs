using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using Ember.Api.TestHost;
using Ember.Core.Data;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
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
        await (await b.Get("/api/me")).Expect(HttpStatusCode.OK);
        var refreshed = await (await RefreshAsync(tokens)).ExpectJson();
        await (await RefreshAsync(refreshed)).Expect(HttpStatusCode.OK);
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
    public async Task Turning_on_two_factor_sign_in_ends_the_other_sessions_and_keeps_this_one()
    {
        var a = await Host.SignedInAsync(consent: false);
        var b = await SecondDeviceAsync(a);

        var key = (await (await a.Post("/api/me/2fa/setup")).ExpectJson()).GetProperty("sharedKey").GetString()!;
        await (await a.Post("/api/me/2fa/enable", new { code = Totp.Code(key), password = ApiClient.Passphrase })).Expect(HttpStatusCode.OK);

        await (await a.Get("/api/me")).Expect(HttpStatusCode.OK);
        await (await b.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
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

    /// <summary>Runs an action once, right after the first query that reads sessions has executed.</summary>
    private sealed class AfterSessionRead(Func<Task> action) : DbCommandInterceptor
    {
        private Func<Task>? pending = action;

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
            DbDataReader result, CancellationToken cancellationToken = default)
        {
            if (pending is { } run && command.CommandText.Contains("FROM \"AuthSessions\""))
            {
                pending = null;
                await run();
            }
            return result;
        }
    }

    /// <summary>Checks a fresh session with <paramref name="duringRead"/> running between the lookup's read and the rest of it.</summary>
    private async Task<(bool During, bool After)> LookupRacingAsync(Func<AuthSessions, Guid, IServiceProvider, Task> duringRead, TimeSpan idle)
    {
        var user = await Host.ConfirmedUserAsync();
        using var scope = Host.Services.CreateScope();
        var sp = scope.ServiceProvider;
        var userId = (await sp.GetRequiredService<UserManager<User>>().FindByEmailAsync(user.Email))!.Id;
        var cache = new MemoryCache(new MemoryCacheOptions());
        var options = sp.GetRequiredService<DbContextOptions<EmberDbContext>>();
        var sessions = new AuthSessions(sp.GetRequiredService<EmberDbContext>(), cache, Host.Time);
        var id = await sessions.StartAsync(userId);
        Host.Time.Advance(idle);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(AuthSessions.ClaimType, id.ToString())], "test"));

        await using var racing = new EmberDbContext(new DbContextOptionsBuilder<EmberDbContext>(options)
            .AddInterceptors(new AfterSessionRead(() => duringRead(sessions, id, sp))).Options);
        var during = await new AuthSessions(racing, cache, Host.Time).IsActiveAsync(principal);
        return (during, await sessions.IsActiveAsync(principal));
    }

    [DockerFact]
    public async Task A_lookup_that_read_the_session_before_it_ended_does_not_keep_it_alive()
    {
        var (_, after) = await LookupRacingAsync((sessions, id, _) => sessions.EndAsync(id), TimeSpan.Zero);

        after.Should().BeFalse();
    }

    [DockerFact]
    public async Task A_session_deleted_before_its_expiry_was_extended_is_not_accepted()
    {
        var (during, after) = await LookupRacingAsync(async (_, id, sp) =>
        {
            await using var other = new EmberDbContext(sp.GetRequiredService<DbContextOptions<EmberDbContext>>());
            await other.AuthSessions.Where(s => s.Id == id).ExecuteDeleteAsync();
        }, TimeSpan.FromMinutes(6));

        during.Should().BeFalse();
        after.Should().BeFalse();
    }

    [DockerFact]
    public async Task Deleting_the_account_ends_its_other_sessions_at_once()
    {
        var a = await Host.SignedInAsync(consent: false);
        var b = await SecondDeviceAsync(a);
        await (await b.Get("/api/me")).Expect(HttpStatusCode.OK);

        await (await a.Post("/api/me/delete", new DeleteRequest(ApiClient.Passphrase, null))).Expect(HttpStatusCode.NoContent);

        (await Host.SessionIsLiveAsync(b)).Should().BeFalse();
    }

    [DockerFact]
    public async Task Signing_in_again_ends_the_session_of_the_cookie_it_replaces()
    {
        var a = await Host.SignedInAsync(consent: false);
        var copied = Host.NewClient();
        copied.AddCookie(CookieName, a.CookieValue(CookieName)!, "/");

        await a.LoginAsync();

        await (await a.Get("/api/me")).Expect(HttpStatusCode.OK);
        await (await copied.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
    }

    [DockerFact]
    public async Task Starting_two_factor_setup_leaves_the_other_sessions_signed_in()
    {
        var a = await Host.SignedInAsync(consent: false);
        var b = await SecondDeviceAsync(a);

        await (await a.Post("/api/me/2fa/setup")).Expect(HttpStatusCode.OK);
        Host.Time.Advance(TimeSpan.FromMinutes(6));

        await (await a.Get("/api/me")).Expect(HttpStatusCode.OK);
        await (await b.Get("/api/me")).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Turning_on_two_factor_sign_in_from_the_app_keeps_its_refresh_token()
    {
        var a = await Host.SignedInAsync(consent: false);
        var tokens = await BearerTokensAsync(a);
        var app = BearerClient(tokens);

        var key = (await (await app.Post("/api/me/2fa/setup")).ExpectJson()).GetProperty("sharedKey").GetString()!;
        await (await app.Post("/api/me/2fa/enable", new { code = Totp.Code(key), password = ApiClient.Passphrase })).Expect(HttpStatusCode.OK);

        await (await a.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
        await (await RefreshAsync(tokens)).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task A_user_keeps_at_most_fifty_sessions_and_a_new_one_ends_the_oldest()
    {
        var user = await Host.ConfirmedUserAsync();
        var userId = await Host.Db(async db => (await db.Users.SingleAsync(u => u.Email == user.Email)).Id);
        var started = new List<Guid>();
        for (var i = 0; i < 51; i++)
        {
            using var scope = Host.Services.CreateScope();
            started.Add(await scope.ServiceProvider.GetRequiredService<AuthSessions>().StartAsync(userId));
            Host.Time.Advance(TimeSpan.FromSeconds(1));
        }

        var kept = await Host.Db(db => db.AuthSessions.Where(s => s.UserId == userId).Select(s => s.Id).ToListAsync());

        kept.Should().BeEquivalentTo(started.Skip(1));
    }

    [DockerFact]
    public async Task The_daily_cleanup_deletes_expired_sessions_and_keeps_live_ones()
    {
        var user = await Host.ConfirmedUserAsync();
        var userId = await Host.Db(async db => (await db.Users.SingleAsync(u => u.Email == user.Email)).Id);
        var now = Host.Time.GetUtcNow();
        await Host.Db(db =>
        {
            db.AuthSessions.AddRange(
                new AuthSession { Id = Guid.NewGuid(), UserId = userId, CreatedUtc = now.AddDays(-15), ExpiresUtc = now.AddMinutes(-1) },
                new AuthSession { Id = Guid.NewGuid(), UserId = userId, CreatedUtc = now.AddDays(-1), ExpiresUtc = now.AddDays(13) });
            return db.SaveChangesAsync();
        });

        await Host.Service(s => s.DeleteExpiredSessionsAsync());

        (await Host.Db(db => db.AuthSessions.Where(s => s.UserId == userId).Select(s => s.ExpiresUtc).ToListAsync()))
            .Should().Equal(now.AddDays(13));
    }
}
