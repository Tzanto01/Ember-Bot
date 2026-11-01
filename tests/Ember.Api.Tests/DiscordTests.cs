using System.Net;
using System.Text.Json;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class DiscordTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string Login = "/api/auth/discord/login";
    private const string Link = "/api/auth/discord/link";

    private static async Task<JsonElement> Me(ApiClient client) => await (await client.Get("/api/me")).ExpectJson();

    private Task<int> LoginRows(ulong discordId)
    {
        var key = DiscordLogin.Key(discordId);
        return Host.Db(db => db.UserLogins.CountAsync(l => l.LoginProvider == DiscordLogin.Provider && l.ProviderKey == key));
    }

    [DockerFact]
    public async Task Discord_login_of_an_existing_bot_only_user_signs_into_that_account_with_its_habits()
    {
        var discordId = ApiHost.NewDiscordId();
        var userId = await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(discordId));
        await Host.Run(s => s.GiveHealthDataConsentAsync(userId));
        await Host.Service(s => s.AddHabitAsync(userId, "Water", null));
        await Host.Service(s => s.AddHabitAsync(userId, "Read", null));
        var client = Host.NewClient();

        var target = await Host.DiscordAsync(client, Login, discordId);

        target.Should().Be("/today");
        var me = await Me(client);
        me.GetProperty("id").GetGuid().Should().Be(userId);
        me.GetProperty("discord").GetProperty("id").GetString().Should().Be(discordId.ToString());
        me.GetProperty("hasPassword").GetBoolean().Should().BeFalse();
        var habits = await (await client.Get("/api/habits")).ExpectJson();
        habits.EnumerateArray().Select(h => h.GetProperty("name").GetString()).Should().BeEquivalentTo("Water", "Read");
    }

    [DockerFact]
    public async Task Discord_login_of_an_unknown_id_creates_one_bot_only_shaped_account_that_later_logins_reuse()
    {
        var discordId = ApiHost.NewDiscordId();
        var first = Host.NewClient();
        var second = Host.NewClient();

        await Host.DiscordAsync(first, Login, discordId);
        await Host.DiscordAsync(second, Login, discordId);

        var me = await Me(first);
        me.GetProperty("email").ValueKind.Should().Be(JsonValueKind.Null);
        me.GetProperty("hasPassword").GetBoolean().Should().BeFalse();
        (await Me(second)).GetProperty("id").GetGuid().Should().Be(me.GetProperty("id").GetGuid());
        (await LoginRows(discordId)).Should().Be(1);
    }

    [DockerFact]
    public async Task Discord_login_redirects_only_to_local_return_paths()
    {
        var discordId = ApiHost.NewDiscordId();
        var cases = new Dictionary<string, string>
        {
            ["/today/x"] = "/today/x",
            ["//evil.example"] = "/today",
            ["/\\evil.example"] = "/today",
            ["https://evil.example"] = "/today",
        };

        foreach (var (returnUrl, expected) in cases)
            (await Host.DiscordAsync(Host.NewClient(), $"{Login}?returnUrl={Uri.EscapeDataString(returnUrl)}", discordId))
                .Should().Be(expected, "returnUrl was {0}", returnUrl);
    }

    [DockerFact]
    public async Task A_cancelled_or_failed_discord_login_ends_at_the_login_error_page_without_a_session()
    {
        var cancelled = Host.NewClient();
        var failed = Host.NewClient();

        (await Host.DiscordAsync(cancelled, Login, deny: true)).Should().Be("/login?discord=error");
        (await Host.DiscordAsync(failed, Login)).Should().Be("/login?discord=error");

        (await cancelled.Get("/api/me")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await failed.Get("/api/me")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [DockerFact]
    public async Task Linking_a_free_id_adds_the_login_and_linking_it_again_is_still_linked()
    {
        var user = await Host.SignedInAsync(consent: false);
        var discordId = ApiHost.NewDiscordId();

        (await Host.DiscordAsync(user, Link, discordId)).Should().Be("/settings?discord=linked");
        (await Host.DiscordAsync(user, Link, discordId)).Should().Be("/settings?discord=linked");

        var discord = (await Me(user)).GetProperty("discord");
        discord.GetProperty("linked").GetBoolean().Should().BeTrue();
        discord.GetProperty("id").GetString().Should().Be(discordId.ToString());
        (await LoginRows(discordId)).Should().Be(1);
    }

    [DockerFact]
    public async Task Linking_an_id_owned_by_a_password_account_is_a_conflict_with_no_pending_merge()
    {
        var owner = await Host.SignedInAsync(consent: false);
        var user = await Host.SignedInAsync(consent: false);
        var discordId = ApiHost.NewDiscordId();
        await Host.DiscordAsync(owner, Link, discordId);

        (await Host.DiscordAsync(user, Link, discordId)).Should().Be("/settings?discord=conflict");

        (await Me(user)).GetProperty("discord").GetProperty("linked").GetBoolean().Should().BeFalse();
        user.CookieValue("ember.merge", "/api/account/merge").Should().BeNull();
        (await Host.Service(s => s.FindDiscordUserAsync(discordId))).Should().Be(await owner.IdAsync());
    }

    [DockerFact]
    public async Task Linking_a_second_discord_id_is_a_conflict_and_keeps_the_first()
    {
        var user = await Host.SignedInAsync(consent: false);
        var first = ApiHost.NewDiscordId();
        var second = ApiHost.NewDiscordId();
        await Host.DiscordAsync(user, Link, first);

        (await Host.DiscordAsync(user, Link, second)).Should().Be("/settings?discord=conflict");

        (await Me(user)).GetProperty("discord").GetProperty("id").GetString().Should().Be(first.ToString());
        (await LoginRows(second)).Should().Be(0);
    }

    [DockerFact]
    public async Task A_link_completes_only_for_the_user_who_started_it_and_cancelling_is_an_error()
    {
        var starter = await Host.SignedInAsync(consent: false);
        var other = await Host.ConfirmedUserAsync();
        var starterEmail = starter.Email;
        var signedOutId = ApiHost.NewDiscordId();
        var otherUserId = ApiHost.NewDiscordId();

        var signedOut = await Host.DiscordAsync(starter, Link, signedOutId,
            beforeComplete: async () => await (await starter.Post("/api/auth/logout")).Expect(HttpStatusCode.NoContent));
        await starter.LoginAsync();
        var swapped = await Host.DiscordAsync(starter, Link, otherUserId, beforeComplete: async () =>
        {
            starter.Email = other.Email;
            await starter.LoginAsync();
        });
        starter.Email = starterEmail;
        await starter.LoginAsync();
        var cancelled = await Host.DiscordAsync(starter, Link, deny: true);

        signedOut.Should().Be("/settings?discord=error");
        swapped.Should().Be("/settings?discord=error");
        cancelled.Should().Be("/settings?discord=error");
        (await LoginRows(signedOutId)).Should().Be(0);
        (await LoginRows(otherUserId)).Should().Be(0);
    }

    [DockerFact]
    public async Task Unlinking_is_refused_for_a_discord_created_account_that_could_not_sign_in_otherwise()
    {
        var discordId = ApiHost.NewDiscordId();
        var client = Host.NewClient();
        await Host.DiscordAsync(client, Login, discordId);
        await client.RefreshCsrfAsync();

        var problem = await (await client.Delete("/api/me/discord")).ExpectProblem(HttpStatusCode.Conflict, "conflict");

        problem.GetProperty("detail").GetString().Should().NotBeNullOrEmpty();
        (await LoginRows(discordId)).Should().Be(1);
    }

    [DockerFact]
    public async Task Unlinking_removes_the_login_for_a_password_account_and_needs_the_antiforgery_token()
    {
        var user = await Host.SignedInAsync(consent: false);
        var discordId = ApiHost.NewDiscordId();
        await Host.DiscordAsync(user, Link, discordId);
        await user.RefreshCsrfAsync();
        var token = user.Csrf;
        user.Csrf = null;

        await (await user.Delete("/api/me/discord")).ExpectProblem(HttpStatusCode.Forbidden, "antiforgery");
        (await LoginRows(discordId)).Should().Be(1);

        user.Csrf = token;
        await (await user.Delete("/api/me/discord")).Expect(HttpStatusCode.NoContent);

        (await LoginRows(discordId)).Should().Be(0);
        (await Me(user)).GetProperty("discord").GetProperty("linked").GetBoolean().Should().BeFalse();
    }
}
