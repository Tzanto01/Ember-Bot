using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Ember.Bot;
using Ember.Bot.Jobs;
using Ember.Bot.Services;
using Ember.Core.Data;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace Ember.Tests;

[Collection("Integration")]
public class WebPushReminderTests
{
    private const string Berlin = "Europe/Berlin";

    private static readonly DateTimeOffset Now = new(2027, 1, 15, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateTime TomorrowNineBerlin = new(2027, 1, 16, 8, 0, 0, DateTimeKind.Utc);

    private sealed record Seed(long Id, ReminderChannels Channels, string[] Endpoints, bool HasDiscordLogin = true);

    private sealed record PushRequest(string Endpoint, string? Authorization, string ContentEncoding, string? Ttl, int BodyLength);

    private sealed class FakePushService : HttpMessageHandler
    {
        private readonly Lock _gate = new();
        private readonly List<PushRequest> _requests = [];

        public Dictionary<string, HttpStatusCode> Responses { get; } = [];

        public IReadOnlyList<PushRequest> Requests
        {
            get
            {
                lock (_gate) return _requests.ToList();
            }
        }

        public IEnumerable<string> Endpoints => Requests.Select(r => r.Endpoint);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken);
            var endpoint = request.RequestUri!.ToString();
            var contentEncoding = request.Content is null ? "" : string.Join(",", request.Content.Headers.ContentEncoding);
            lock (_gate)
            {
                _requests.Add(new PushRequest(endpoint,
                    request.Headers.TryGetValues("Authorization", out var authorization) ? authorization.First() : null,
                    contentEncoding,
                    request.Headers.TryGetValues("TTL", out var ttl) ? ttl.First() : null,
                    body.Length));
            }

            return new HttpResponseMessage(Responses.GetValueOrDefault(endpoint, HttpStatusCode.Created));
        }
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static (string Public, string Private) NewKeyPair()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var parameters = key.ExportParameters(true);
        return (Base64Url([0x04, .. parameters.Q.X!, .. parameters.Q.Y!]), Base64Url(parameters.D!));
    }

    private static string Endpoint(string label) => $"https://fcm.googleapis.com/send/{label}";

    private static async Task<(IntegrationTestHost Host, FakePushService Push, FakeTimeProvider Time)> CreateAsync(params Seed[] seeds)
    {
        var push = new FakePushService();
        var time = new FakeTimeProvider(Now);
        var (publicKey, privateKey) = NewKeyPair();
        var host = await IntegrationTestHost.CreateAsync(start: false, time: time,
            args: [$"--WebPush:PublicKey={publicKey}", $"--WebPush:PrivateKey={privateKey}", "--WebPush:Subject=mailto:test@example.test"],
            configureServices: services => services.AddHttpClient(WebPushReminderChannel.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(() => push));

        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            foreach (var seed in seeds)
            {
                var user = new User { Id = TestUsers.Id(seed.Id), Timezone = Berlin };
                if (seed.HasDiscordLogin) user.Logins = TestUsers.Discord(seed.Id);
                else user.UserName = $"web{seed.Id}@example.com";
                db.Users.Add(user);
                db.Habits.Add(new Habit
                {
                    Id = (int)seed.Id, UserId = user.Id, Name = $"Habit {seed.Id}", ReminderTime = new TimeOnly(9, 0),
                    NextReminderUtc = Now.UtcDateTime, CreatedAt = Now.UtcDateTime.AddDays(-30), ReminderChannels = seed.Channels,
                });
                foreach (var endpoint in seed.Endpoints)
                {
                    var (clientKey, _) = NewKeyPair();
                    db.PushSubscriptions.Add(new Ember.Core.Models.PushSubscription
                    {
                        UserId = user.Id, Endpoint = endpoint, P256dh = clientKey, Auth = Base64Url(RandomNumberGenerator.GetBytes(16)),
                    });
                }
            }
            await db.SaveChangesAsync();
        });
        return (host, push, time);
    }

    private static Task RunJobAsync(IntegrationTestHost host)
        => ActivatorUtilities.CreateInstance<ReminderDispatchJob>(host.Host.Services).RunAsync();

    private static Task<User> UserAsync(IntegrationTestHost host, long id)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users.SingleAsync(u => u.Id == TestUsers.Id(id)));

    private static Task<DateTime?> NextReminderAsync(IntegrationTestHost host, int habitId)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits
            .Where(h => h.Id == habitId).Select(h => h.NextReminderUtc).SingleAsync());

    private static Task<List<string>> StoredEndpointsAsync(IntegrationTestHost host)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().PushSubscriptions.Select(s => s.Endpoint).ToListAsync());

    private const ReminderChannels Both = ReminderChannels.Discord | ReminderChannels.WebPush;

    [Fact]
    public void BuildingTheBotHostWithOnlyThePublicKey_FailsNamingTheWebPushSettings()
    {
        var builder = AppHost.CreateHostBuilder(["--WebPush:PublicKey=only-the-public-key"], new EmberHostOptions
        {
            IncludeDiscordGateway = false,
            ConfigureDbContext = (options, _) => options.UseSqlite("Data Source=:memory:"),
        });

        var build = () => builder.Build();

        build.Should().Throw<InvalidOperationException>().WithMessage("*WebPush*");
    }

    [Fact]
    public async Task EachDueReminder_GoesOnlyThroughTheSelectedChannelsTheUserCanReceive()
    {
        var (host, push, _) = await CreateAsync(
            new Seed(10, ReminderChannels.Discord, [Endpoint("u10")]),
            new Seed(20, ReminderChannels.WebPush, [Endpoint("u20a"), Endpoint("u20b")]),
            new Seed(30, Both, [Endpoint("u30")]),
            new Seed(40, ReminderChannels.None, [Endpoint("u40")]),
            new Seed(50, ReminderChannels.WebPush, []),
            new Seed(60, Both, [Endpoint("u60")], HasDiscordLogin: false));
        await using var hostScope = host;

        await RunJobAsync(host);

        host.Discord.Messages.Select(m => m.UserId).Should().BeEquivalentTo([10UL, 30UL]);
        push.Endpoints.Should().BeEquivalentTo([Endpoint("u20a"), Endpoint("u20b"), Endpoint("u30"), Endpoint("u60")]);
        (await NextReminderAsync(host, 40)).Should().Be(TomorrowNineBerlin);
        (await NextReminderAsync(host, 50)).Should().Be(TomorrowNineBerlin);
        (await UserAsync(host, 60)).DmFailureCount.Should().Be(0);
    }

    [Fact]
    public async Task AMobileOnlyReminder_SendsNeitherDiscordNorWebPush_AndStillAdvances()
    {
        var (host, push, _) = await CreateAsync(new Seed(10, ReminderChannels.Mobile, [Endpoint("u10")]));
        await using var hostScope = host;

        await RunJobAsync(host);

        host.Discord.Messages.Should().BeEmpty();
        push.Requests.Should().BeEmpty();
        (await NextReminderAsync(host, 10)).Should().Be(TomorrowNineBerlin);
    }

    [Fact]
    public async Task RunningTheDispatchTwiceForTheSameDueTime_SendsOncePerChannel()
    {
        var (host, push, _) = await CreateAsync(new Seed(30, Both, [Endpoint("u30")]));
        await using var hostScope = host;

        await RunJobAsync(host);
        await RunJobAsync(host);

        host.Discord.Messages.Should().ContainSingle();
        push.Requests.Should().ContainSingle();
        (await NextReminderAsync(host, 30)).Should().Be(TomorrowNineBerlin);
    }

    [Fact]
    public async Task PushOutcomesNeverTouchTheDmFailureCount_AndDmPausedUsersStillGetPush()
    {
        var (host, push, time) = await CreateAsync(
            new Seed(10, ReminderChannels.WebPush, [Endpoint("u10")]),
            new Seed(20, Both, [Endpoint("u20")]));
        await using var hostScope = host;
        push.Responses[Endpoint("u10")] = HttpStatusCode.InternalServerError;
        host.Discord.Deliver = _ => DeliveryOutcome.Undeliverable;

        for (var day = 0; day < 4; day++)
        {
            await RunJobAsync(host);
            time.Advance(TimeSpan.FromDays(1));
        }

        var failingPush = await UserAsync(host, 10);
        failingPush.DmFailureCount.Should().Be(0);
        failingPush.DmRemindersPausedAt.Should().BeNull();
        push.Endpoints.Count(e => e == Endpoint("u10")).Should().Be(4);
        var failingDm = await UserAsync(host, 20);
        failingDm.DmFailureCount.Should().Be(3);
        failingDm.DmRemindersPausedAt.Should().NotBeNull();
        host.Discord.Messages.Should().HaveCount(3);
        push.Endpoints.Count(e => e == Endpoint("u20")).Should().Be(4);
    }

    [Fact]
    public async Task SubscriptionsThePushServiceReportsGone_AreDeleted_AndTheRequestIsEncryptedAndVapidSigned()
    {
        var (host, push, _) = await CreateAsync(
            new Seed(10, ReminderChannels.WebPush, [Endpoint("gone"), Endpoint("missing"), Endpoint("ok")]),
            new Seed(20, ReminderChannels.None, [Endpoint("other")]));
        await using var hostScope = host;
        push.Responses[Endpoint("gone")] = HttpStatusCode.Gone;
        push.Responses[Endpoint("missing")] = HttpStatusCode.NotFound;

        await RunJobAsync(host);

        push.Requests.Should().HaveCount(3);
        (await StoredEndpointsAsync(host)).Should().BeEquivalentTo([Endpoint("ok"), Endpoint("other")]);
        var delivered = push.Requests.Single(r => r.Endpoint == Endpoint("ok"));
        delivered.ContentEncoding.Should().Be("aes128gcm");
        delivered.Authorization!.ToLowerInvariant().Should().StartWith("vapid ");
        delivered.Ttl.Should().Be(WebPushReminderChannel.TimeToLiveSeconds.ToString());
        delivered.BodyLength.Should().BeGreaterThan(0);

        var payload = JsonDocument.Parse(WebPushReminderChannel.Payload).RootElement.GetProperty("notification");
        payload.GetProperty("title").GetString().Should().Be("Ember");
        payload.GetProperty("body").GetString().Should().NotContain("Habit 10");
        var click = payload.GetProperty("data").GetProperty("onActionClick").GetProperty("default");
        click.GetProperty("operation").GetString().Should().Be("navigateLastFocusedOrOpen");
        click.GetProperty("url").GetString().Should().Be("/today");
    }
}
