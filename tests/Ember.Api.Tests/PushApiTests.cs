using System.Net;
using System.Security.Cryptography;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class PushApiTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string Subscriptions = "/api/me/push-subscriptions";

    protected override Dictionary<string, string?>? Settings => new() { ["WebPush:PublicKey"] = "test-vapid-public-key" };

    private static string Base64Url(int bytes) => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(bytes));

    private static Task<HttpResponseMessage> Subscribe(ApiClient client, string endpoint, string? p256dh = null, string? auth = null)
        => client.Post(Subscriptions, new { endpoint, keys = new { p256dh = p256dh ?? Base64Url(65), auth = auth ?? Base64Url(16) } });

    private Task<List<string>> EndpointsOf(Guid userId)
        => Host.Db(db => db.PushSubscriptions.Where(s => s.UserId == userId).OrderBy(s => s.Id).Select(s => s.Endpoint).ToListAsync());

    private static string FcmEndpoint() => $"https://fcm.googleapis.com/fcm/send/{Guid.NewGuid():N}";

    private static List<string?> Channels(System.Text.Json.JsonElement habit)
        => habit.GetProperty("reminderChannels").EnumerateArray().Select(c => c.GetString()).ToList();

    [DockerFact]
    public async Task The_vapid_public_key_is_returned_when_configured()
    {
        var key = await (await Host.NewClient().Get("/api/push/vapid-public-key")).ExpectJson();

        key.GetProperty("key").GetString().Should().Be("test-vapid-public-key");
    }

    [DockerFact]
    public async Task Only_https_endpoints_on_known_push_services_are_accepted_and_keys_are_required()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        var allowed = new[]
        {
            "https://fcm.googleapis.com/fcm/send/abc",
            "https://updates.push.services.mozilla.com/wpush/v2/abc",
            "https://wns2-par02p.notify.windows.com/w/?token=abc",
            "https://web.push.apple.com/abc",
        };
        var rejected = new[]
        {
            "http://fcm.googleapis.com/fcm/send/abc",
            "https://localhost/fcm/send/abc",
            "https://127.0.0.1/fcm/send/abc",
            "https://[::1]/fcm/send/abc",
            "https://169.254.169.254/latest/meta-data",
            "https://fcm.googleapis.com.evil.test/fcm/send/abc",
            "https://fcm.googleapis.com@evil.test/fcm/send/abc",
            "https://fcm.googleapis.com:8443/fcm/send/abc",
            "",
        };

        foreach (var endpoint in allowed)
            await (await Subscribe(user, endpoint)).Expect(HttpStatusCode.NoContent);
        foreach (var endpoint in rejected)
        {
            var problem = await (await Subscribe(user, endpoint)).ExpectProblem(HttpStatusCode.BadRequest, "validation");
            problem.GetProperty("errors").Has("endpoint").Should().BeTrue("endpoint {0} must be rejected", endpoint);
        }
        var noKeys = await (await Subscribe(user, FcmEndpoint(), p256dh: "", auth: "")).ExpectProblem(HttpStatusCode.BadRequest, "validation");

        noKeys.GetProperty("errors").EnumerateObject().Select(e => e.Name).Should().Contain(["keys.p256dh", "keys.auth"]);
        (await EndpointsOf(userId)).Should().BeEquivalentTo(allowed);
    }

    [DockerFact]
    public async Task An_endpoint_moves_to_the_latest_account_and_only_its_owner_can_delete_it()
    {
        var a = await Host.SignedInAsync();
        var b = await Host.SignedInAsync();
        var aId = await a.IdAsync();
        var bId = await b.IdAsync();
        var shared = FcmEndpoint();
        var aOnly = FcmEndpoint();
        await (await Subscribe(a, shared)).Expect(HttpStatusCode.NoContent);
        await (await Subscribe(a, aOnly)).Expect(HttpStatusCode.NoContent);

        await (await Subscribe(b, shared)).Expect(HttpStatusCode.NoContent);

        (await EndpointsOf(aId)).Should().Equal(aOnly);
        (await EndpointsOf(bId)).Should().Equal(shared);

        await (await b.Delete($"{Subscriptions}?endpoint={Uri.EscapeDataString(aOnly)}")).Expect(HttpStatusCode.NoContent);
        (await EndpointsOf(aId)).Should().Equal(aOnly);

        await (await a.Delete($"{Subscriptions}?endpoint={Uri.EscapeDataString(aOnly)}")).Expect(HttpStatusCode.NoContent);
        (await EndpointsOf(aId)).Should().BeEmpty();
        (await EndpointsOf(bId)).Should().Equal(shared);
    }

    [DockerFact]
    public async Task A_user_keeps_only_their_ten_most_recent_subscriptions()
    {
        var user = await Host.SignedInAsync();
        var endpoints = Enumerable.Range(0, 12).Select(_ => FcmEndpoint()).ToList();

        foreach (var endpoint in endpoints)
            await (await Subscribe(user, endpoint)).Expect(HttpStatusCode.NoContent);

        (await EndpointsOf(await user.IdAsync())).Should().BeEquivalentTo(endpoints.Skip(2));
    }

    [DockerFact]
    public async Task Reminder_channels_round_trip_reject_unknown_values_and_differ_for_bot_created_habits()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        var created = await user.CreateHabitAsync();
        var id = created.GetProperty("id").GetInt32();
        Channels(created).Should().Equal("webpush");

        var both = await (await user.Patch($"/api/habits/{id}", new { reminderChannels = new[] { "discord", "webpush" } })).ExpectJson();
        Channels(both).Should().BeEquivalentTo("discord", "webpush");
        Channels(await (await user.Patch($"/api/habits/{id}", new { reminderChannels = new[] { "mobile" } })).ExpectJson()).Should().Equal("mobile");
        Channels(await (await user.Get($"/api/habits/{id}")).ExpectJson()).Should().Equal("mobile");
        var mixed = await (await user.Patch($"/api/habits/{id}", new { reminderChannels = new[] { "discord", "mobile" } })).ExpectJson();
        Channels(mixed).Should().BeEquivalentTo("discord", "mobile");
        await (await user.Patch($"/api/habits/{id}", new { reminderChannels = new[] { "discord", "webpush" } })).ExpectJson();
        await (await user.Patch($"/api/habits/{id}", new { name = "Renamed", reminderChannels = new[] { "sms" } })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var unchanged = await (await user.Get($"/api/habits/{id}")).ExpectJson();
        Channels(unchanged).Should().BeEquivalentTo("discord", "webpush");
        unchanged.GetProperty("name").GetString().Should().NotBe("Renamed");
        var none = await (await user.Patch($"/api/habits/{id}", new { reminderChannels = Array.Empty<string>() })).ExpectJson();
        Channels(none).Should().BeEmpty();

        var botHabit = await Host.Service(s => s.AddHabitAsync(userId, "From the bot", null));
        Channels(await (await user.Get($"/api/habits/{botHabit.Id}")).ExpectJson()).Should().Equal("discord");
    }

    [DockerFact]
    public async Task Export_lists_reminder_channels_and_push_subscription_endpoints()
    {
        var user = await Host.SignedInAsync();
        var id = (await user.CreateHabitAsync()).GetProperty("id").GetInt32();
        await (await user.Patch($"/api/habits/{id}", new { reminderChannels = new[] { "discord", "webpush" } })).ExpectJson();
        var endpoint = FcmEndpoint();
        await (await Subscribe(user, endpoint)).Expect(HttpStatusCode.NoContent);

        var export = await (await user.Get("/api/me/export?format=json")).ExpectJson();

        export.GetProperty("habits")[0].GetProperty("reminder_channels").EnumerateArray().Select(c => c.GetString())
            .Should().BeEquivalentTo("discord", "webpush");
        export.GetProperty("push_subscriptions").EnumerateArray().Select(p => p.GetProperty("endpoint").GetString())
            .Should().Equal(endpoint);
        export.GetProperty("push_subscriptions").ToString().Should().NotContain("p256dh").And.NotContain("auth");
    }

    [DockerFact]
    public async Task A_merge_leaves_the_account_with_its_ten_most_recently_saved_subscriptions()
    {
        var user = await Host.SignedInAsync();
        var own = new[] { FcmEndpoint(), FcmEndpoint() };
        foreach (var endpoint in own)
            await (await Subscribe(user, endpoint)).Expect(HttpStatusCode.NoContent);
        var discordId = ApiHost.NewDiscordId();
        var botId = await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(discordId));
        var now = Host.Time.GetUtcNow().UtcDateTime;
        var botEndpoints = Enumerable.Range(1, 11).Select(_ => FcmEndpoint()).ToList();
        await Host.Db(async db =>
        {
            db.PushSubscriptions.AddRange(botEndpoints.Select((endpoint, i) => new Ember.Core.Models.PushSubscription
            {
                UserId = botId, Endpoint = endpoint, P256dh = Base64Url(65), Auth = Base64Url(16), CreatedAt = now.AddMinutes(-(i + 1)),
            }));
            return await db.SaveChangesAsync();
        });
        (await Host.DiscordAsync(user, "/api/auth/discord/link", discordId)).Should().Be("/link/merge");

        await (await user.Post("/api/account/merge")).Expect(HttpStatusCode.NoContent);

        (await EndpointsOf(await user.IdAsync())).Should().BeEquivalentTo(own.Concat(botEndpoints.Take(8)));
    }

    [DockerFact]
    public async Task Merging_a_bot_only_account_moves_its_push_subscriptions()
    {
        var user = await Host.SignedInAsync();
        var discordId = ApiHost.NewDiscordId();
        var botId = await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(discordId));
        var endpoint = FcmEndpoint();
        await Host.Db(async db =>
        {
            db.PushSubscriptions.Add(new Ember.Core.Models.PushSubscription { UserId = botId, Endpoint = endpoint, P256dh = Base64Url(65), Auth = Base64Url(16) });
            return await db.SaveChangesAsync();
        });
        (await Host.DiscordAsync(user, "/api/auth/discord/link", discordId)).Should().Be("/link/merge");

        await (await user.Post("/api/account/merge")).Expect(HttpStatusCode.NoContent);

        (await EndpointsOf(await user.IdAsync())).Should().Equal(endpoint);
    }
}
