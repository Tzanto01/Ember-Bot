using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Discord;
using Ember.Bot.Jobs;
using Ember.Bot.Services;
using Ember.Core.Data;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;
using Quartz;

namespace Ember.Tests;

[Collection("Integration")]
public class NotificationLanguageTests
{
    // Friday 2027-01-15, 09:00 in Berlin (UTC+1).
    private static readonly DateTimeOffset Now = new(2027, 1, 15, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset SundayMorningUtc = new(2026, 1, 18, 9, 0, 0, TimeSpan.Zero);

    private static User DiscordUser(long id, string language, int secondReminderMinutes = 0) => new()
    {
        Id = TestUsers.Id(id),
        Logins = TestUsers.Discord(id),
        DiscordReminders = true,
        Timezone = "Europe/Berlin",
        Language = language,
        SecondReminderMinutes = secondReminderMinutes,
    };

    private static Habit DueHabit(int id, long userId, string name) => new()
    {
        Id = id,
        UserId = TestUsers.Id(userId),
        Name = name,
        ReminderTime = new TimeOnly(9, 0),
        NextReminderUtc = Now.UtcDateTime,
        CreatedAt = Now.UtcDateTime.AddDays(-30),
    };

    private static async Task<IntegrationTestHost> CreateHostAsync(FakeTimeProvider time, User[] users, Habit[] habits,
        string[]? args = null, Action<IServiceCollection>? configureServices = null, Action<EmberDbContext>? seed = null)
    {
        var host = await IntegrationTestHost.CreateAsync(start: false, time: time, args: args, configureServices: configureServices);
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            db.Users.AddRange(users);
            db.Habits.AddRange(habits);
            seed?.Invoke(db);
            await db.SaveChangesAsync();
        });
        return host;
    }

    private static Task RunDispatchAsync(IntegrationTestHost host)
        => ActivatorUtilities.CreateInstance<ReminderDispatchJob>(host.Host.Services).RunAsync();

    private static IEnumerable<string> ButtonLabels(SentDiscordDm dm)
        => dm.Components!.Components.OfType<ActionRowComponent>().SelectMany(r => r.Components).OfType<ButtonComponent>().Select(b => b.Label);

    [Fact]
    public async Task ScheduledReminder_ArrivesInEachUsersLanguage_WithTheHabitNameUntranslated()
    {
        await using var host = await CreateHostAsync(new FakeTimeProvider(Now),
            [DiscordUser(10, "en"), DiscordUser(20, "de")],
            [DueHabit(1, 10, "Read"), DueHabit(2, 20, "Lesen")]);

        await RunDispatchAsync(host);

        var english = host.Discord.Messages.Single(m => m.UserId == 10);
        english.Text.Should().Be("Hey 👋 Checking in on **Read**. It's been a little while, and that's okay. Today's a fresh start " +
            "whenever you're ready.\n\nDid you follow this habit today?");
        ButtonLabels(english).Should().Equal("Done ✅", "Skip for today", "Snooze 1h ⏰", "Stop Discord reminders");

        var german = host.Discord.Messages.Single(m => m.UserId == 20);
        german.Text.Should().Be("Hey 👋 Wie steht's mit **Lesen**? Ist ein Weilchen her, und das ist okay. Heute ist ein neuer Anfang, " +
            "wann immer du so weit bist.\n\nHast du diesen Habit heute gemacht?");
        ButtonLabels(german).Should().Equal("Erledigt ✅", "Heute auslassen", "1 Std. später ⏰", "Discord-Erinnerungen stoppen");
    }

    [Fact]
    public async Task SecondReminder_IsInGerman_ForAGermanUser()
    {
        var time = new FakeTimeProvider(Now);
        await using var host = await CreateHostAsync(time, [DiscordUser(30, "de", secondReminderMinutes: 30)], [DueHabit(3, 30, "Lesen")]);

        await RunDispatchAsync(host);
        time.Advance(TimeSpan.FromMinutes(30));
        await RunDispatchAsync(host);

        host.Discord.Messages.Should().HaveCount(2);
        host.Discord.Messages[^1].Text.Should()
            .Be("🔔 Noch ein kleiner Schubs für **Lesen**, falls der erste untergegangen ist. Bist du heute dazu gekommen?");
    }

    [Fact]
    public async Task WeeklySummary_IsInGerman_ForAGermanUser()
    {
        await using var host = await IntegrationTestHost.CreateAsync(time: new FakeTimeProvider(SundayMorningUtc));
        await host.WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<EmberDbContext>();
            var today = DateOnly.FromDateTime(SundayMorningUtc.UtcDateTime);
            var user = new User { Id = TestUsers.Id(56), Logins = TestUsers.Discord(56), Timezone = "UTC", Language = "de", ShowStreaks = true };
            var habit = new Habit { UserId = user.Id, Name = "Meditieren", CreatedAt = SundayMorningUtc.UtcDateTime.AddDays(-8) };
            habit.Logs.Add(new HabitLog { Date = today.AddDays(-1), Completed = true });
            habit.Logs.Add(new HabitLog { Date = today.AddDays(-3), Completed = true });
            user.Habits.Add(habit);
            db.Users.Add(user);
            await db.SaveChangesAsync();
        });

        var scheduler = await host.WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        await scheduler.TriggerJob(WeeklySummaryJob.Key);
        await host.WaitForDmCountAsync(1);

        var embed = host.Discord.Messages.Single().Embed!;
        embed.Title.Should().Be("🗓️ Deine Woche mit deinen Habits");
        embed.Description.Should().Be("Diese Woche hast du **2 Check-ins** geschafft. Jeder davon zählt. 💪");
        embed.Footer!.Value.Text.Should().Be("Auch kleine Schritte bringen dich weiter. Du schaffst das.");
        embed.Fields.Should().ContainSingle(f => f.Name == "Meditieren")
            .Which.Value.Should().Be("⬜⬜⬜⬜✅⬜✅ **2/7** · Streak: **2** Tage _(+1 Gnadentag)_");
    }

    [Fact]
    public async Task WebPushReminder_IsInGerman_ForAGermanUser()
    {
        var push = new RecordingPushService();
        using var client = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var auth = RandomNumberGenerator.GetBytes(16);
        using var vapid = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var vapidKey = vapid.ExportParameters(true);

        await using var host = await CreateHostAsync(new FakeTimeProvider(Now),
            [new User { Id = TestUsers.Id(40), UserName = "web40@example.com", Timezone = "Europe/Berlin", Language = "de" }],
            [DueHabit(4, 40, "Lesen")],
            args: [$"--WebPush:PublicKey={Base64Url(PublicKey(vapidKey.Q))}", $"--WebPush:PrivateKey={Base64Url(vapidKey.D!)}",
                "--WebPush:Subject=mailto:test@example.test"],
            configureServices: services => services.AddHttpClient(WebPushReminderChannel.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(() => push),
            seed: db => db.PushSubscriptions.Add(new Ember.Core.Models.PushSubscription
            {
                UserId = TestUsers.Id(40),
                Endpoint = "https://fcm.googleapis.com/send/de",
                P256dh = Base64Url(PublicKey(client.ExportParameters(false).Q)),
                Auth = Base64Url(auth),
            }));

        await RunDispatchAsync(host);

        var body = push.Bodies.Should().ContainSingle().Subject;
        var notification = JsonNode.Parse(Decrypt(body, client, auth))!["notification"]!;
        notification["title"]!.GetValue<string>().Should().Be("Ember");
        notification["body"]!.GetValue<string>().Should().Be("Ein sanfter Schubs von Ember");
    }

    private sealed class RecordingPushService : HttpMessageHandler
    {
        public List<byte[]> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Bodies.Add(await request.Content!.ReadAsByteArrayAsync(cancellationToken));
            return new HttpResponseMessage(HttpStatusCode.Created);
        }
    }

    private static byte[] PublicKey(ECPoint q) => [0x04, .. q.X!, .. q.Y!];

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Decrypts an RFC 8291 aes128gcm web push body as the browser holding <paramref name="client"/> would.</summary>
    private static string Decrypt(byte[] body, ECDiffieHellman client, byte[] auth)
    {
        var salt = body[..16];
        var idLength = body[20];
        var serverKey = body[21..(21 + idLength)];
        var cipher = body[(21 + idLength)..];

        using var server = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = serverKey[1..33], Y = serverKey[33..] },
        });
        var shared = client.DeriveRawSecretAgreement(server.PublicKey);
        byte[] keyInfo = [.. "WebPush: info\0"u8, .. PublicKey(client.ExportParameters(false).Q), .. serverKey];
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, shared, 32, auth, keyInfo);
        var cek = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 16, salt, "Content-Encoding: aes128gcm\0"u8.ToArray());
        var nonce = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 12, salt, "Content-Encoding: nonce\0"u8.ToArray());

        var plain = new byte[cipher.Length - 16];
        using (var aes = new AesGcm(cek, 16))
            aes.Decrypt(nonce, cipher[..^16], cipher[^16..], plain);
        var end = Array.LastIndexOf(plain, (byte)2);
        return Encoding.UTF8.GetString(plain, 0, end);
    }
}
