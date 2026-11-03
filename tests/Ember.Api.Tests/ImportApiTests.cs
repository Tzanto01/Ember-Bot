using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

/// <summary><c>POST /api/me/import</c> (contract "Export format v2").</summary>
[Collection("Postgres")]
public class ImportApiTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private static string B64(int bytes) => Convert.ToBase64String(Enumerable.Repeat((byte)7, bytes).ToArray());

    private static readonly object Blob = new { v = 1, iv = B64(12), ct = B64(32) };

    private static readonly object Key = new
    {
        version = 4,
        turning_off = true,
        passphrase = new { salt = B64(16), iterations = 600_000, iv = B64(12), wrapped = B64(48) },
        recovery = new { salt = B64(16), iv = B64(12), wrapped = B64(48) },
    };

    private static readonly string[] IgnoredSettings =
    [
        "dm_failure_count", "dm_reminders_paused_at", "dm_pause_notice_sent_at",
        "health_data_consent_at", "consent_policy_version", "consent_prompted_on", "two_factor_enabled",
    ];

    private static object HabitItem(int id, string name = "Water")
        => new { id, name, frequency = "daily", times_per_day = 1, created_at = "2026-10-20T08:00:00Z", reminder_time = "09:00", reminder_channels = new[] { "webpush" } };

    private static object Doc(object[]? habits = null, object[]? logs = null, object[]? moods = null, object[]? dayNotes = null,
        object? journalKey = null, int formatVersion = 2, string? padding = null) => new
        {
            format_version = formatVersion,
            settings = new { grace_days_per_week = 1 },
            habits = habits ?? [HabitItem(1)],
            logs = logs ?? [],
            day_marks = Array.Empty<object>(),
            routines = Array.Empty<object>(),
            moods = moods ?? [],
            day_notes = dayNotes ?? [],
            journal_key = journalKey,
            padding,
        };

    private static Task<HttpResponseMessage> Import(ApiClient user, object doc) => user.Post("/api/me/import", doc);

    private Task<int> HabitCountAsync(Guid userId) => Host.Db(db => db.Habits.CountAsync(h => h.UserId == userId));

    private static async Task<JsonElement> ErrorsAsync(HttpResponseMessage response)
        => (await response.ExpectProblem(HttpStatusCode.BadRequest, "validation")).GetProperty("errors");

    /// <summary>The export without what import ignores, with every id replaced by its index in its section.</summary>
    private static string Comparable(string json)
    {
        var root = JsonNode.Parse(json)!.AsObject();
        root.Remove("account");
        root.Remove("push_subscriptions");
        foreach (var field in IgnoredSettings) root["settings"]!.AsObject().Remove(field);

        var habits = Reindex(root["habits"]!);
        var routines = Reindex(root["routines"]!);
        var moods = Reindex(root["moods"]!);
        foreach (var habit in root["habits"]!.AsArray())
            if (habit!["routine_id"] is { } routineId) habit["routine_id"] = routines[(int)routineId];
        foreach (var log in root["logs"]!.AsArray())
            log!["habit_id"] = habits[(int)log["habit_id"]!];
        foreach (var note in root["day_notes"]!.AsArray())
            if ((string?)note!["mood"] is { } mood && mood.StartsWith("custom:"))
                note["mood"] = $"custom:{moods[int.Parse(mood[7..])]}";
        return root.ToJsonString();
    }

    private static Dictionary<int, int> Reindex(JsonNode section)
    {
        var map = new Dictionary<int, int>();
        foreach (var item in section.AsArray())
        {
            map[(int)item!["id"]!] = map.Count;
            item["id"] = map.Count - 1;
        }
        return map;
    }

    [DockerFact]
    public async Task An_export_imported_into_a_fresh_account_exports_the_same_data()
    {
        var source = await Host.SignedInAsync();
        var sourceId = await source.IdAsync();
        var today = Host.Today;
        await (await source.Patch("/api/me", new { graceDaysPerWeek = 2, theme = "tidepool" })).Expect(HttpStatusCode.OK);
        int Id(JsonElement e) => e.GetProperty("id").GetInt32();
        var water = Id(await (await source.Post("/api/habits", new { name = "Water", frequency = "daily", timesPerDay = 3, reminderTime = "09:00" }))
            .ExpectJson(HttpStatusCode.Created));
        var gym = Id(await (await source.Post("/api/habits", new { name = "Gym", frequency = "weekdays", days = new[] { "mon", "wed", "fri" } }))
            .ExpectJson(HttpStatusCode.Created));
        var read = Id(await (await source.Post("/api/habits", new { name = "Read", frequency = "weekly", weeklyTarget = 2 }))
            .ExpectJson(HttpStatusCode.Created));
        await Host.Db(db => db.Habits.Where(h => h.UserId == sourceId)
            .ExecuteUpdateAsync(s => s.SetProperty(h => h.CreatedAt, h => h.CreatedAt.AddDays(-10))));

        await (await source.Put($"/api/habits/{water}/days/{today.AddDays(-4).Iso()}", new { count = 3 })).Expect(HttpStatusCode.OK);
        await (await source.Patch($"/api/habits/{water}", new { timesPerDay = 4 })).Expect(HttpStatusCode.OK);
        await (await source.Put($"/api/habits/{water}/days/{today.AddDays(-3).Iso()}", new { count = 2 })).Expect(HttpStatusCode.OK);
        await (await source.Put($"/api/habits/{water}/days/{today.AddDays(-2).Iso()}", new { completed = false })).Expect(HttpStatusCode.OK);
        await (await source.Put($"/api/habits/{gym}/days/{today.AddDays(-5).Iso()}", new { completed = true })).Expect(HttpStatusCode.OK);
        await (await source.Put($"/api/habits/{read}/days/{today.AddDays(-1).Iso()}", new { completed = true })).Expect(HttpStatusCode.OK);
        await (await source.Post($"/api/habits/{gym}/pause", new { until = today.AddDays(3).Iso() })).Expect(HttpStatusCode.OK);
        await (await source.Put($"/api/low-days/{today.AddDays(-6).Iso()}")).Expect(HttpStatusCode.NoContent);
        await (await source.Post("/api/routines", new
        {
            name = "Morning",
            reminderTime = "07:30",
            reminderChannels = new[] { "mobile" },
            habitIds = new[] { read, water }
        })).Expect(HttpStatusCode.Created);
        var proud = Id(await (await source.Post("/api/moods", new { label = "Proud", emoji = "🦁" })).ExpectJson(HttpStatusCode.Created));
        var tired = Id(await (await source.Post("/api/moods", new { label = "Tired" })).ExpectJson(HttpStatusCode.Created));
        await (await source.Put($"/api/day-notes/{today.AddDays(-3).Iso()}", new { text = "Long day", mood = $"custom:{tired}" })).Expect(HttpStatusCode.OK);
        await (await source.Put($"/api/day-notes/{today.AddDays(-2).Iso()}", new { mood = $"custom:{proud}" })).Expect(HttpStatusCode.OK);
        await (await source.Put($"/api/day-notes/{today.AddDays(-1).Iso()}", new { mood = "good" })).Expect(HttpStatusCode.OK);
        await (await source.Patch($"/api/moods/{tired}", new { archived = true })).Expect(HttpStatusCode.OK);
        var exported = await (await source.Get("/api/me/export?format=json")).Expect(HttpStatusCode.OK);

        var target = await Host.SignedInAsync();
        await (await Import(target, JsonDocument.Parse(exported).RootElement)).Expect(HttpStatusCode.NoContent);
        var reexported = await (await target.Get("/api/me/export?format=json")).Expect(HttpStatusCode.OK);

        var expected = Comparable(exported);
        JsonNode.Parse(expected)!["logs"]!.AsArray().Should().HaveCount(5);
        expected.Should().Contain("\"completed\":true,\"guild_id\":null,\"count\":3").And.Contain("\"routine_position\":1")
            .And.Contain("\"archived\":true").And.Contain("\"paused_until\"").And.Contain("\"next_reminder_utc\":\"20");
        Comparable(reexported).Should().Be(expected);
    }

    [DockerFact]
    public async Task An_account_with_data_is_a_409_and_keeps_its_data()
    {
        var user = await Host.SignedInAsync();
        await user.CreateHabitAsync("Existing");

        await (await Import(user, Doc())).ExpectProblem(HttpStatusCode.Conflict, "conflict");

        (await (await user.Get("/api/habits")).ExpectJson()).EnumerateArray().Select(h => h.GetProperty("name").GetString())
            .Should().Equal("Existing");
    }

    [DockerFact]
    public async Task A_leftover_low_day_makes_the_account_not_empty()
    {
        var user = await Host.SignedInAsync();
        var habit = await user.CreateHabitAsync();
        var today = DateOnly.Parse((await (await user.Get("/api/me")).ExpectJson()).GetProperty("localToday").GetString()!);
        await (await user.Put($"/api/low-days/{today.Iso()}")).Expect(HttpStatusCode.NoContent);
        await (await user.Delete($"/api/habits/{habit.GetProperty("id").GetInt32()}")).Expect(HttpStatusCode.NoContent);

        await (await Import(user, Doc())).ExpectProblem(HttpStatusCode.Conflict, "conflict");

        (await HabitCountAsync(await user.IdAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task Only_format_version_2_is_accepted()
    {
        var user = await Host.SignedInAsync();

        (await ErrorsAsync(await Import(user, Doc(formatVersion: 1)))).Has("format_version").Should().BeTrue();
        (await HabitCountAsync(await user.IdAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task Import_needs_consent()
    {
        var user = await Host.SignedInAsync(consent: false);

        await (await Import(user, Doc())).ExpectProblem(HttpStatusCode.Forbidden, "consent_required");
        (await HabitCountAsync(await user.IdAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task An_invalid_nested_field_is_a_400_with_its_path_and_writes_nothing()
    {
        var user = await Host.SignedInAsync();
        var doc = Doc(
            habits: [HabitItem(1), HabitItem(2, "   ")],
            logs: [new { habit_id = 1, date = "2026-10-25", completed = true, count = 1 }, new { habit_id = 1, date = "2026-10-26", completed = false, count = 2 }]);

        var errors = await ErrorsAsync(await Import(user, doc));

        errors.Has("habits[1].name").Should().BeTrue();
        errors.Has("logs[1].count").Should().BeTrue();
        errors.Has("habits[0].name").Should().BeFalse();
        (await HabitCountAsync(await user.IdAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task More_than_25_habits_is_a_409_habit_limit()
    {
        var user = await Host.SignedInAsync();

        await (await Import(user, Doc(habits: Enumerable.Range(1, 26).Select(i => HabitItem(i, $"Habit {i}")).ToArray())))
            .ExpectProblem(HttpStatusCode.Conflict, "habit_limit");
        (await HabitCountAsync(await user.IdAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task Encrypted_notes_and_moods_import_with_their_journal_key_which_starts_at_version_1()
    {
        var user = await Host.SignedInAsync();
        var moods = new object[] { new { id = 9, encrypted = Blob, archived = false } };
        var note = new { date = "2026-10-25", encrypted = Blob };

        var mixed = await ErrorsAsync(await Import(user, Doc(moods: moods, journalKey: Key,
            dayNotes: [note, new { date = "2026-10-26", text = "Plain", mood = (string?)null }])));
        mixed.Has("day_notes[1].encrypted").Should().BeTrue();

        await (await Import(user, Doc(moods: moods, dayNotes: [note], journalKey: Key))).Expect(HttpStatusCode.NoContent);

        var key = await (await user.Get("/api/me/journal-key")).ExpectJson();
        (key.GetProperty("version").GetInt32(), key.GetProperty("turningOff").GetBoolean()).Should().Be((1, false));
        var notes = await (await user.Get("/api/day-notes?from=2026-10-20")).ExpectJson();
        notes.EnumerateArray().Single().GetProperty("encrypted").GetProperty("ct").GetString().Should().Be(B64(32));
        (await (await user.Get("/api/moods")).ExpectJson()).EnumerateArray().Single().Has("encrypted").Should().BeTrue();
    }

    [DockerFact]
    public async Task Encrypted_notes_without_a_journal_key_are_a_400()
    {
        var user = await Host.SignedInAsync();

        var errors = await ErrorsAsync(await Import(user, Doc(dayNotes: [new { date = "2026-10-25", encrypted = Blob }])));

        errors.Has("day_notes[0].encrypted").Should().BeTrue();
        (await HabitCountAsync(await user.IdAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task Import_bodies_may_be_up_to_5_mib_while_other_endpoints_keep_64_kib()
    {
        Host.UseKestrel(0);
        var user = await KestrelUserAsync();

        (await user.PostAsJsonAsync("/api/me/import", Doc(padding: new string('x', 70 * 1024)))).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await (await user.GetAsync("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(1);
        (await user.PutAsJsonAsync("/api/day-notes/2026-10-25", new { text = "x", padding = new string('x', 70 * 1024) }))
            .StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);

        var other = await KestrelUserAsync();
        var huge = new HttpRequestMessage(HttpMethod.Post, "/api/me/import")
        {
            Content = new StringContent(JsonSerializer.Serialize(Doc(padding: new string('x', 5 * 1024 * 1024))), Encoding.UTF8, "application/json"),
        };
        huge.Headers.ExpectContinue = true;
        (await other.SendAsync(huge)).StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        (await (await other.GetAsync("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(0);
    }

    /// <summary>A confirmed, consented user signed in with a bearer token on a client of the Kestrel server (the test server has no body size limit).</summary>
    private async Task<HttpClient> KestrelUserAsync()
    {
        var http = Host.CreateClient();
        var email = ApiHost.NewEmail();
        await (await http.PostAsJsonAsync("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        var query = QueryHelpers.ParseQuery(new Uri((await Host.Mail.WaitForAsync(email, 1)).Single().Link()).Query);
        await (await http.PostAsJsonAsync("/api/auth/confirmEmail",
            new ConfirmRequest(query["userId"].ToString(), query["code"].ToString(), ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        var tokens = await (await http.PostAsJsonAsync("/api/auth/login", new Credentials(email, ApiClient.Passphrase))).ExpectJson();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());
        await (await http.PostAsJsonAsync("/api/me/consent", new { policyVersion = "2026-10" })).Expect(HttpStatusCode.NoContent);
        return http;
    }
}
