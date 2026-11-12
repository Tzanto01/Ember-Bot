using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Ember.Bot;
using Ember.Bot.Jobs;
using Ember.Bot.Services;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
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

    /// <summary>A user with one habit due now. <paramref name="Discord"/>/<paramref name="Push"/> false exclude Discord or every browser from the habit.</summary>
    private sealed record Seed(long Id, string[] Endpoints, bool Discord = true, bool Push = true, bool HasDiscordLogin = true,
        bool? DiscordAnswer = true);

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
                var user = new User { Id = TestUsers.Id(seed.Id), Timezone = Berlin, DiscordReminders = seed.DiscordAnswer };
                if (seed.HasDiscordLogin) user.Logins = TestUsers.Discord(seed.Id);
                else user.UserName = $"web{seed.Id}@example.com";
                db.Users.Add(user);
                db.Habits.Add(new Habit
                {
                    Id = (int)seed.Id, UserId = user.Id, Name = $"Habit {seed.Id}", ReminderTime = new TimeOnly(9, 0),
                    NextReminderUtc = Now.UtcDateTime, CreatedAt = Now.UtcDateTime.AddDays(-30),
                    ReminderExclusions = seed.Discord ? [] : [ReminderDestinations.Discord],
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
            foreach (var seed in seeds.Where(s => !s.Push))
            {
                var habit = await db.Habits.SingleAsync(h => h.Id == (int)seed.Id);
                habit.ReminderExclusions = [.. habit.ReminderExclusions,
                    .. db.PushSubscriptions.Where(s => s.UserId == habit.UserId).Select(s => s.Id).AsEnumerable().Select(ReminderDestinations.Browser)];
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
    public async Task EachDueReminder_GoesOnlyToTheDestinationsNotExcludedThatTheUserCanReceive()
    {
        var (host, push, _) = await CreateAsync(
            new Seed(10, [Endpoint("u10")], Push: false),
            new Seed(20, [Endpoint("u20a"), Endpoint("u20b")], Discord: false),
            new Seed(30, [Endpoint("u30")]),
            new Seed(40, [Endpoint("u40")], Discord: false, Push: false),
            new Seed(50, [], Discord: false),
            new Seed(60, [Endpoint("u60")], HasDiscordLogin: false));
        await using var hostScope = host;

        await RunJobAsync(host);

        host.Discord.Messages.Select(m => m.UserId).Should().BeEquivalentTo([10UL, 30UL]);
        push.Endpoints.Should().BeEquivalentTo([Endpoint("u20a"), Endpoint("u20b"), Endpoint("u30"), Endpoint("u60")]);
        (await NextReminderAsync(host, 40)).Should().Be(TomorrowNineBerlin);
        (await NextReminderAsync(host, 50)).Should().Be(TomorrowNineBerlin);
        (await UserAsync(host, 60)).DmFailureCount.Should().Be(0);
    }

    [Fact]
    public async Task AReminderExcludedFromEveryServerDestination_SendsNeitherDiscordNorWebPush_AndStillAdvances()
    {
        var (host, push, _) = await CreateAsync(new Seed(10, [Endpoint("u10")], Discord: false, Push: false));
        await using var hostScope = host;

        await RunJobAsync(host);

        host.Discord.Messages.Should().BeEmpty();
        push.Requests.Should().BeEmpty();
        (await NextReminderAsync(host, 10)).Should().Be(TomorrowNineBerlin);
    }

    [Fact]
    public async Task RunningTheDispatchTwiceForTheSameDueTime_SendsOncePerChannel()
    {
        var (host, push, _) = await CreateAsync(new Seed(30, [Endpoint("u30")]));
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
            new Seed(10, [Endpoint("u10")], Discord: false),
            new Seed(20, [Endpoint("u20")]));
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
            new Seed(10, [Endpoint("gone"), Endpoint("missing"), Endpoint("ok")], Discord: false),
            new Seed(20, [Endpoint("other")], Discord: false, Push: false));
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

    [Fact]
    public async Task A_single_habit_reminder_carries_a_one_time_done_token_and_a_routine_reminder_does_not()
    {
        var (host, push, _) = await CreateAsync(
            new Seed(20, [Endpoint("routine")], Discord: false),
            new Seed(30, [Endpoint("habit")], Discord: false));
        await using var hostScope = host;
        var routineId = await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var routine = new Routine
            {
                UserId = TestUsers.Id(20), Name = "A much longer routine name than any habit", ReminderTime = new TimeOnly(9, 0),
                NextReminderUtc = Now.UtcDateTime,
            };
            routine.Habits.Add(await db.Habits.SingleAsync(h => h.Id == 20));
            db.Routines.Add(routine);
            await db.SaveChangesAsync();
            return routine.Id;
        });

        await LinkLiveSessionAsync(host, 20);
        await LinkLiveSessionAsync(host, 30);

        await RunJobAsync(host);

        push.Endpoints.Should().BeEquivalentTo([Endpoint("routine"), Endpoint("habit")]);
        var token = await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().ReminderActionTokens.SingleAsync());
        token.UserId.Should().Be(TestUsers.Id(30));
        token.HabitId.Should().Be(30);
        token.Day.Should().Be(new DateOnly(2027, 1, 15));
        token.ExpiresUtc.Should().Be(new DateTime(2027, 1, 16, 9, 0, 0, DateTimeKind.Utc));
        token.UsedUtc.Should().BeNull();
        token.TokenHash.Should().HaveCount(32);
        var withToken = WebPushReminderChannel.BuildPayload("A gentle nudge from Ember", new string('x', 43), WebPushReminderChannel.HabitTag(30));
        var plain = WebPushReminderChannel.BuildPayload("A gentle nudge from Ember", tag: WebPushReminderChannel.RoutineTag(routineId));
        var bodyLength = (string endpoint) => push.Requests.Single(r => r.Endpoint == Endpoint(endpoint)).BodyLength;
        (bodyLength("habit") - bodyLength("routine")).Should().Be(withToken.Length - plain.Length);
    }

    /// <summary>Records a sign-in session for the user that expires in <paramref name="expiresIn"/> and ties their subscriptions to it.</summary>
    private static Task LinkLiveSessionAsync(IntegrationTestHost host, long id, string? endpoint = null, TimeSpan? expiresIn = null)
        => host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var session = new AuthSession
            {
                Id = Guid.NewGuid(), UserId = TestUsers.Id(id), CreatedUtc = Now, ExpiresUtc = Now + (expiresIn ?? TimeSpan.FromDays(14)),
            };
            db.AuthSessions.Add(session);
            await db.SaveChangesAsync();
            await db.PushSubscriptions.Where(s => s.UserId == session.UserId && (endpoint == null || s.Endpoint == endpoint))
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.SessionId, session.Id));
        });

    [Fact]
    public async Task Only_subscriptions_of_a_live_session_get_the_done_token()
    {
        var (host, push, _) = await CreateAsync(new Seed(30, [Endpoint("live"), Endpoint("legacy"), Endpoint("expired")], Discord: false));
        await using var hostScope = host;
        await LinkLiveSessionAsync(host, 30, Endpoint("live"));
        await LinkLiveSessionAsync(host, 30, Endpoint("expired"), TimeSpan.Zero);

        await RunJobAsync(host);

        (await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().ReminderActionTokens.CountAsync())).Should().Be(1);
        var bodyLength = (string endpoint) => push.Requests.Single(r => r.Endpoint == Endpoint(endpoint)).BodyLength;
        var extra = WebPushReminderChannel.BuildPayload("A gentle nudge from Ember", new string('x', 43)).Length - WebPushReminderChannel.Payload.Length;
        (bodyLength("live") - bodyLength("legacy")).Should().Be(extra);
        bodyLength("expired").Should().Be(bodyLength("legacy"));
    }

    [Fact]
    public async Task Without_any_live_session_no_token_is_created()
    {
        var (host, push, _) = await CreateAsync(new Seed(30, [Endpoint("legacy")], Discord: false));
        await using var hostScope = host;

        await RunJobAsync(host);

        push.Requests.Should().ContainSingle();
        (await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().ReminderActionTokens.CountAsync())).Should().Be(0);
    }

    [Fact]
    public void The_done_payload_adds_the_action_and_token_and_still_names_no_habit()
    {
        var plain = JsonNode.Parse(WebPushReminderChannel.Payload)!["notification"]!;
        var done = JsonNode.Parse(WebPushReminderChannel.BuildPayload("A gentle nudge from Ember", "the-token"))!["notification"]!;

        plain.AsObject().ContainsKey("actions").Should().BeFalse();
        plain["data"]!.AsObject().ContainsKey("doneToken").Should().BeFalse();
        done["title"]!.GetValue<string>().Should().Be("Ember");
        done["actions"]!.ToJsonString().Should().Be(new JsonArray(new JsonObject { ["action"] = "done", ["title"] = "Done ✅" }).ToJsonString());
        done["data"]!["doneToken"]!.GetValue<string>().Should().Be("the-token");
        done["data"]!["onActionClick"]!.ToJsonString().Should().Be(plain["data"]!["onActionClick"]!.ToJsonString());
    }

    [Fact]
    public void A_second_reminder_has_its_own_body_and_otherwise_the_same_payload()
    {
        var first = JsonNode.Parse(WebPushReminderChannel.Payload)!["notification"]!;
        var second = JsonNode.Parse(WebPushReminderChannel.SecondPayload)!["notification"]!;

        second["body"]!.GetValue<string>().Should().Be("One more nudge, in case the first one got buried.");
        second["body"] = first["body"]!.GetValue<string>();
        second.ToJsonString().Should().Be(first.ToJsonString());
    }

    private static Task SetSecondReminderAsync(IntegrationTestHost host, long id, int minutes)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users.Where(u => u.Id == TestUsers.Id(id))
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.SecondReminderMinutes, minutes)));

    [Fact]
    public async Task A_second_reminder_goes_out_over_web_push_with_the_second_payload()
    {
        var (host, push, time) = await CreateAsync(new Seed(20, [Endpoint("a")], Discord: false));
        await using var hostScope = host;
        await SetSecondReminderAsync(host, 20, 15);

        await RunJobAsync(host);
        time.Advance(TimeSpan.FromMinutes(15));
        await RunJobAsync(host);

        var requests = push.Requests.Should().HaveCount(2).And.Subject.ToList();
        (requests[1].BodyLength - requests[0].BodyLength).Should()
            .Be(WebPushReminderChannel.SecondPayload.Length - WebPushReminderChannel.Payload.Length);
    }

    [Fact]
    public async Task An_undeliverable_second_reminder_dm_does_not_count_as_another_dm_failure()
    {
        var (host, push, time) = await CreateAsync(new Seed(20, [Endpoint("a")]));
        await using var hostScope = host;
        await SetSecondReminderAsync(host, 20, 15);
        host.Discord.Deliver = _ => DeliveryOutcome.Undeliverable;

        await RunJobAsync(host);
        time.Advance(TimeSpan.FromMinutes(15));
        await RunJobAsync(host);

        host.Discord.Messages.Should().HaveCount(2);
        push.Requests.Should().HaveCount(2);
        (await UserAsync(host, 20)).DmFailureCount.Should().Be(1);
    }

    private static Task<int> SubscriptionIdAsync(IntegrationTestHost host, string endpoint)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().PushSubscriptions.Where(s => s.Endpoint == endpoint).Select(s => s.Id).SingleAsync());

    private static async Task ExcludeAsync(IntegrationTestHost host, int habitId, params string[] endpoints)
    {
        var ids = new List<string>();
        foreach (var endpoint in endpoints) ids.Add(ReminderDestinations.Browser(await SubscriptionIdAsync(host, endpoint)));
        await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits.Where(h => h.Id == habitId)
            .ExecuteUpdateAsync(s => s.SetProperty(h => h.ReminderExclusions, ids)));
    }

    private static Task LogAsync(IntegrationTestHost host, int habitId, DateOnly date)
        => host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.HabitLogs.Add(new HabitLog { HabitId = habitId, Date = date, Completed = true, Count = 1 });
            return await db.SaveChangesAsync();
        });

    private static Task<int> PushRemindersAsync(IntegrationTestHost host)
        => host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().PushReminders.CountAsync());

    private static readonly DateOnly Today = new(2027, 1, 15);

    [Fact]
    public async Task Excluding_one_browser_still_reminds_the_others_first_and_second_time()
    {
        var (host, push, time) = await CreateAsync(new Seed(20, [Endpoint("a"), Endpoint("b")], Discord: false));
        await using var hostScope = host;
        await ExcludeAsync(host, 20, Endpoint("a"));
        await SetSecondReminderAsync(host, 20, 15);

        await RunJobAsync(host);
        time.Advance(TimeSpan.FromMinutes(15));
        await RunJobAsync(host);

        push.Endpoints.Should().Equal(Endpoint("b"), Endpoint("b"));
    }

    [Fact]
    public async Task A_browser_turned_off_gets_no_reminder_for_any_habit_while_discord_still_does()
    {
        var (host, push, _) = await CreateAsync(new Seed(20, [Endpoint("a")]));
        await using var hostScope = host;
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Habits.Add(new Habit
            {
                Id = 21, UserId = TestUsers.Id(20), Name = "Habit 21", ReminderTime = new TimeOnly(9, 0),
                NextReminderUtc = Now.UtcDateTime, CreatedAt = Now.UtcDateTime.AddDays(-30),
            });
            await db.SaveChangesAsync();
            return await db.PushSubscriptions.ExecuteUpdateAsync(s => s.SetProperty(p => p.Enabled, false));
        });

        await RunJobAsync(host);

        push.Requests.Should().BeEmpty();
        host.Discord.Messages.Should().HaveCount(2);
    }

    [Fact]
    public async Task Discord_reminders_go_only_to_accounts_that_answered_yes()
    {
        var (host, _, _) = await CreateAsync(
            new Seed(10, [], DiscordAnswer: null),
            new Seed(20, [], DiscordAnswer: false),
            new Seed(30, [], DiscordAnswer: true));
        await using var hostScope = host;

        await RunJobAsync(host);

        host.Discord.Messages.Select(m => m.UserId).Should().Equal(30UL);
        (await NextReminderAsync(host, 10)).Should().Be(TomorrowNineBerlin);
    }

    [Fact]
    public async Task Logging_a_habit_sends_one_clear_push_with_its_tag_to_the_browsers_it_reminds_on()
    {
        var (host, push, _) = await CreateAsync(new Seed(20, [Endpoint("a"), Endpoint("b")], Discord: false));
        await using var hostScope = host;
        await ExcludeAsync(host, 20, Endpoint("b"));
        await RunJobAsync(host);
        (await PushRemindersAsync(host)).Should().Be(1);
        await RunJobAsync(host);
        push.Requests.Should().ContainSingle();

        await LogAsync(host, 20, Today);
        await RunJobAsync(host);
        await RunJobAsync(host);

        var requests = push.Requests;
        requests.Select(r => r.Endpoint).Should().Equal(Endpoint("a"), Endpoint("a"));
        var tag = WebPushReminderChannel.HabitTag(20);
        (requests[1].BodyLength - requests[0].BodyLength).Should()
            .Be(WebPushReminderChannel.ClearPayload(tag).Length - WebPushReminderChannel.BuildPayload("A gentle nudge from Ember", tag: tag).Length);
        (await PushRemindersAsync(host)).Should().Be(0);
    }

    [Fact]
    public void The_clear_payload_names_the_tag_and_shows_a_logged_notification_for_old_service_workers()
    {
        var payload = JsonNode.Parse(WebPushReminderChannel.ClearPayload("routine-7"))!;

        payload["clear"]!["tag"]!.GetValue<string>().Should().Be("routine-7");
        payload["notification"]!["title"]!.GetValue<string>().Should().Be("Ember");
        payload["notification"]!["body"]!.GetValue<string>().Should().Be("Logged. Nice work. ✅");
        payload["notification"]!["data"]!["onActionClick"]!["default"]!["url"]!.GetValue<string>().Should().Be("/today");
        JsonNode.Parse(WebPushReminderChannel.BuildPayload("x", tag: "habit-3"))!["notification"]!["tag"]!.GetValue<string>().Should().Be("habit-3");
    }

    [Fact]
    public async Task A_delivered_reminder_that_expires_unlogged_is_forgotten_without_a_push()
    {
        var (host, push, time) = await CreateAsync(new Seed(20, [Endpoint("a")], Discord: false));
        await using var hostScope = host;
        await RunJobAsync(host);
        await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Habits
            .ExecuteUpdateAsync(s => s.SetProperty(h => h.NextReminderUtc, (DateTime?)null)));

        time.Advance(TimeSpan.FromHours(24));
        await RunJobAsync(host);
        (await PushRemindersAsync(host)).Should().Be(1);
        time.Advance(TimeSpan.FromHours(1));
        await RunJobAsync(host);

        push.Requests.Should().ContainSingle();
        (await PushRemindersAsync(host)).Should().Be(0);
    }

    [Fact]
    public async Task Transient_discord_failures_next_to_a_delivered_push_never_pause_dm_reminders()
    {
        var (host, push, _) = await CreateAsync(new Seed(20, [Endpoint("a")]));
        await using var hostScope = host;
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            foreach (var id in new[] { 21, 22 })
                db.Habits.Add(new Habit
                {
                    Id = id, UserId = TestUsers.Id(20), Name = $"Habit {id}", ReminderTime = new TimeOnly(9, 0),
                    NextReminderUtc = Now.UtcDateTime, CreatedAt = Now.UtcDateTime.AddDays(-30),
                });
            return await db.SaveChangesAsync();
        });
        host.Discord.Deliver = _ => throw new HttpRequestException("503");

        await RunJobAsync(host);

        push.Requests.Should().HaveCount(3);
        var user = await UserAsync(host, 20);
        user.DmRemindersPausedAt.Should().BeNull();
        user.DmFailureCount.Should().Be(0);
    }

    [Fact]
    public async Task A_routine_reminder_delivered_by_web_push_is_cleared_once_when_every_member_is_logged()
    {
        var (host, push, _) = await CreateAsync(new Seed(20, [Endpoint("a")], Discord: false));
        await using var hostScope = host;
        var routineId = await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var routine = new Routine
            {
                UserId = TestUsers.Id(20), Name = "Morning", ReminderTime = new TimeOnly(9, 0), NextReminderUtc = Now.UtcDateTime,
                ReminderExclusions = [ReminderDestinations.Discord],
            };
            db.Routines.Add(routine);
            await db.SaveChangesAsync();
            db.Habits.Add(new Habit
            {
                Id = 21, UserId = TestUsers.Id(20), Name = "Habit 21", RoutineId = routine.Id, RoutinePosition = 1,
                CreatedAt = Now.UtcDateTime.AddDays(-30),
            });
            var member = await db.Habits.SingleAsync(h => h.Id == 20);
            (member.RoutineId, member.ReminderTime, member.NextReminderUtc) = (routine.Id, null, null);
            await db.SaveChangesAsync();
            return routine.Id;
        });
        await RunJobAsync(host);
        push.Requests.Should().ContainSingle();
        (await PushRemindersAsync(host)).Should().Be(1);

        await LogAsync(host, 20, Today);
        await RunJobAsync(host);
        push.Requests.Should().ContainSingle();
        await LogAsync(host, 21, Today);
        await RunJobAsync(host);
        await RunJobAsync(host);

        var requests = push.Requests.Should().HaveCount(2).And.Subject.ToList();
        var tag = WebPushReminderChannel.RoutineTag(routineId);
        (requests[1].BodyLength - requests[0].BodyLength).Should()
            .Be(WebPushReminderChannel.ClearPayload(tag).Length - WebPushReminderChannel.BuildPayload("A gentle nudge from Ember", tag: tag).Length);
        (await PushRemindersAsync(host)).Should().Be(0);
    }
}
