using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class ReminderDestinationsApiTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string Destinations = "/api/me/reminder-destinations";
    private const string FirefoxLinux = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
    private const string EdgeWindows =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";

    private static string Base64Url(int bytes) => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(bytes));

    private static string InstallId() => Base64Url(18);

    /// <summary>Saves a synthetic push subscription as a browser with <paramref name="userAgent"/> and returns its destination id.</summary>
    private static async Task<string> SubscribeAsync(ApiClient client, string userAgent = FirefoxLinux)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/me/push-subscriptions")
        {
            Content = System.Net.Http.Json.JsonContent.Create(new
            {
                endpoint = $"https://fcm.googleapis.com/fcm/send/{Guid.NewGuid():N}",
                keys = new { p256dh = Base64Url(65), auth = Base64Url(16) },
            }),
        };
        request.Headers.TryAddWithoutValidation("User-Agent", userAgent);
        if (client.Csrf is not null) request.Headers.Add("X-XSRF-TOKEN", client.Csrf);
        (await client.Http.SendAsync(request)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        return (await ListAsync(client)).Last(d => d.Kind == "browser").Id;
    }

    private sealed record Destination(string Id, string Kind, string Label, bool Enabled, bool Current);

    private static async Task<List<Destination>> ListAsync(ApiClient client)
        => (await (await client.Get(Destinations)).ExpectJson()).EnumerateArray()
            .Select(d => new Destination(d.GetProperty("id").GetString()!, d.GetProperty("kind").GetString()!, d.GetProperty("label").GetString()!,
                d.GetProperty("enabled").GetBoolean(), d.GetProperty("current").GetBoolean()))
            .ToList();

    private static List<string?> Strings(JsonElement item, string property)
        => item.GetProperty(property).EnumerateArray().Select(c => c.GetString()).ToList();

    [DockerFact]
    public async Task Destinations_list_discord_then_browsers_then_phones_with_readable_labels_and_the_current_device()
    {
        var user = await Host.SignedInAsync();
        await Host.DiscordAsync(user, "/api/auth/discord/link", ApiHost.NewDiscordId());
        var firefox = await SubscribeAsync(user);
        var phone = await (await user.Post("/api/me/phones", new { installId = InstallId(), label = "  Pixel 8  " })).ExpectJson();

        var list = await ListAsync(user);

        list.Should().Equal(
            new Destination("discord", "discord", "Discord DMs", false, false),
            new Destination(firefox, "browser", "Firefox on Linux", true, true),
            new Destination(phone.GetProperty("id").GetString()!, "phone", "Pixel 8", true, true));
        await SubscribeAsync(user, EdgeWindows);
        (await ListAsync(user)).Where(d => d.Kind == "browser").Select(d => d.Label).Should().Equal("Firefox on Linux", "Edge on Windows");
    }

    [DockerFact]
    public async Task Only_the_owner_can_toggle_a_destination_and_every_other_id_is_the_same_404()
    {
        var a = await Host.SignedInAsync();
        var b = await Host.SignedInAsync();
        var browser = await SubscribeAsync(a);
        var number = browser["browser-".Length..];

        foreach (var id in new[] { browser, "discord", "browser-0" + number, "browser-x", "phone-" + number, "nope" })
            await (await b.Patch($"{Destinations}/{id}", new { enabled = false })).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        (await ListAsync(b)).Should().BeEmpty();
        (await (await a.Patch($"{Destinations}/{browser}", new { })).ExpectProblem(HttpStatusCode.BadRequest, "validation"))
            .GetProperty("errors").Has("enabled").Should().BeTrue();
        (await ListAsync(a)).Single().Enabled.Should().BeTrue();

        var off = await (await a.Patch($"{Destinations}/{browser}", new { enabled = false })).ExpectJson();

        off.GetProperty("enabled").GetBoolean().Should().BeFalse();
        (await ListAsync(a)).Single().Enabled.Should().BeFalse();
    }

    [DockerFact]
    public async Task Turning_discord_on_records_the_accounts_answer()
    {
        var user = await Host.SignedInAsync();
        await Host.DiscordAsync(user, "/api/auth/discord/link", ApiHost.NewDiscordId());
        var userId = await user.IdAsync();

        (await (await user.Patch($"{Destinations}/discord", new { enabled = true })).ExpectJson()).GetProperty("enabled").GetBoolean()
            .Should().BeTrue();

        (await Host.Db(db => db.Users.Where(u => u.Id == userId).Select(u => u.DiscordReminders).SingleAsync())).Should().BeTrue();
    }

    [DockerFact]
    public async Task Exclusions_take_only_the_callers_destination_ids_and_drive_server_reminders_and_the_legacy_channels()
    {
        var a = await Host.SignedInAsync();
        var b = await Host.SignedInAsync();
        var own = await SubscribeAsync(a);
        var foreign = await SubscribeAsync(b);
        var habit = (await a.CreateHabitAsync()).GetProperty("id").GetInt32();

        var everywhere = await (await a.Get($"/api/habits/{habit}")).ExpectJson();
        everywhere.GetProperty("serverReminders").GetBoolean().Should().BeTrue();
        Strings(everywhere, "reminderChannels").Should().Equal("webpush");
        foreach (var bad in new[] { foreign, "discord", "browser-999999" })
            (await (await a.Patch($"/api/habits/{habit}", new { reminderExclusions = new[] { bad } }))
                .ExpectProblem(HttpStatusCode.BadRequest, "validation")).GetProperty("errors").Has("reminderExclusions").Should().BeTrue();
        await (await a.Post("/api/routines", new { name = "Morning", reminderExclusions = new[] { foreign } }))
            .ExpectProblem(HttpStatusCode.BadRequest, "validation");

        var excluded = await (await a.Patch($"/api/habits/{habit}", new { reminderExclusions = new[] { own, own }, reminderChannels = new[] { "sms" } }))
            .ExpectJson();

        Strings(excluded, "reminderExclusions").Should().Equal(own);
        excluded.GetProperty("serverReminders").GetBoolean().Should().BeFalse();
        Strings(excluded, "reminderChannels").Should().Equal("mobile");
        var routine = await (await a.Post("/api/routines", new { name = "Morning", reminderTime = "07:00", reminderExclusions = new[] { own } }))
            .ExpectJson(HttpStatusCode.Created);
        Strings(routine, "reminderExclusions").Should().Equal(own);
        routine.GetProperty("serverReminders").GetBoolean().Should().BeFalse();
        await (await a.Patch($"/api/habits/{habit}", new { reminderExclusions = Array.Empty<string>() })).ExpectJson();
        await (await a.Patch($"{Destinations}/{own}", new { enabled = false })).ExpectJson();
        (await (await a.Get($"/api/habits/{habit}")).ExpectJson()).GetProperty("serverReminders").GetBoolean().Should().BeFalse();
    }

    [DockerFact]
    public async Task Ids_of_destinations_that_are_gone_are_not_returned()
    {
        var user = await Host.SignedInAsync();
        var browser = await SubscribeAsync(user);
        var habit = (await user.CreateHabitAsync()).GetProperty("id").GetInt32();
        await (await user.Patch($"/api/habits/{habit}", new { reminderExclusions = new[] { browser } })).ExpectJson();
        var userId = await user.IdAsync();

        await Host.Db(db => db.PushSubscriptions.Where(s => s.UserId == userId).ExecuteDeleteAsync());

        Strings(await (await user.Get($"/api/habits/{habit}")).ExpectJson(), "reminderExclusions").Should().BeEmpty();
    }

    [DockerFact]
    public async Task A_phone_registers_once_per_install_keeps_its_switch_moves_to_the_latest_account_and_ends_with_its_session()
    {
        var a = await Host.SignedInAsync();
        var b = await Host.SignedInAsync();
        var install = InstallId();
        foreach (var body in new object[]
                 {
                     new { installId = "short" }, new { installId = install + "!" }, new { installId = install + "\n" }, new { label = "Pixel" },
                     new { installId = install, label = "Pixel‮8" }, new { installId = install, label = new string('x', 61) },
                 })
            await (await a.Post("/api/me/phones", body)).ExpectProblem(HttpStatusCode.BadRequest, "validation");

        var first = await (await a.Post("/api/me/phones", new { installId = install })).ExpectJson();
        var id = first.GetProperty("id").GetString()!;
        first.GetProperty("label").GetString().Should().Be("Android phone");
        first.GetProperty("current").GetBoolean().Should().BeTrue();
        await (await a.Patch($"{Destinations}/{id}", new { enabled = false })).ExpectJson();
        var again = await (await a.Post("/api/me/phones", new { installId = install, label = "Pixel 8" })).ExpectJson();
        (again.GetProperty("id").GetString(), again.GetProperty("label").GetString(), again.GetProperty("enabled").GetBoolean())
            .Should().Be((id, "Pixel 8", false));

        var moved = await (await b.Post("/api/me/phones", new { installId = install })).ExpectJson();

        moved.GetProperty("id").GetString().Should().NotBe(id);
        moved.GetProperty("enabled").GetBoolean().Should().BeTrue();
        (await ListAsync(a)).Should().BeEmpty();
        await (await b.Post("/api/auth/logout")).Expect(HttpStatusCode.NoContent);
        (await Host.Db(db => db.ReminderPhones.CountAsync(p => p.InstallId == install))).Should().Be(0);
    }

    [DockerFact]
    public async Task Ending_every_other_session_removes_the_phones_it_registered()
    {
        var phoneDevice = await Host.SignedInAsync();
        var userId = await phoneDevice.IdAsync();
        await (await phoneDevice.Post("/api/me/phones", new { installId = InstallId() })).ExpectJson();
        var desktop = Host.NewClient();
        desktop.Email = phoneDevice.Email;
        await desktop.LoginAsync();

        await (await desktop.Post("/api/auth/logout-everywhere")).Expect(HttpStatusCode.NoContent);

        (await Host.Db(db => db.ReminderPhones.CountAsync(p => p.UserId == userId))).Should().Be(0);
    }

    [DockerFact]
    public async Task Export_lists_reminder_exclusions_browser_labels_and_phones_without_the_install_id()
    {
        var user = await Host.SignedInAsync();
        var browser = await SubscribeAsync(user);
        var install = InstallId();
        await (await user.Post("/api/me/phones", new { installId = install, label = "Pixel 8" })).ExpectJson();
        var habit = (await user.CreateHabitAsync()).GetProperty("id").GetInt32();
        await (await user.Patch($"/api/habits/{habit}", new { reminderExclusions = new[] { browser } })).ExpectJson();

        var export = await (await user.Get("/api/me/export?format=json")).ExpectJson();

        Strings(export.GetProperty("habits")[0], "reminder_exclusions").Should().Equal(browser);
        var subscription = export.GetProperty("push_subscriptions")[0];
        (subscription.GetProperty("label").GetString(), subscription.GetProperty("enabled").GetBoolean()).Should().Be(("Firefox on Linux", true));
        var phone = export.GetProperty("phones").EnumerateArray().Should().ContainSingle().Subject;
        (phone.GetProperty("label").GetString(), phone.GetProperty("enabled").GetBoolean()).Should().Be(("Pixel 8", true));
        export.ToString().Should().NotContain(install);
    }
}
