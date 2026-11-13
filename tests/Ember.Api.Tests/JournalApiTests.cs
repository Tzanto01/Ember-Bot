using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

/// <summary>Journal for the day, own moods (contract "Features v1.6") and the private journal key ("Privacy levels v1.7").</summary>
[Collection("Postgres")]
public class JournalApiTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private sealed record KeyRequest(object Passphrase, object Recovery, string? Password, int? IfVersion);
    private sealed record TurnOffRequest(string? Password);
    private sealed record DeleteKeyRequest(string? Password, bool DiscardEncrypted);

    private static string B64(int bytes) => Convert.ToBase64String(Enumerable.Repeat((byte)7, bytes).ToArray());

    private static readonly object Blob = new { v = 1, iv = B64(12), ct = B64(32) };

    private static KeyRequest KeyBody(string? secret = ApiClient.Passphrase, int? ifVersion = null, string? passphraseSalt = null,
        int iterations = 600_000, string? recoveryWrapped = null) => new(
        new { salt = passphraseSalt ?? B64(16), iterations, iv = B64(12), wrapped = B64(48) },
        new { salt = B64(16), iv = B64(12), wrapped = recoveryWrapped ?? B64(48) },
        secret, ifVersion);

    private static async Task<DateOnly> TodayAsync(ApiClient user)
        => DateOnly.Parse((await (await user.Get("/api/me")).ExpectJson()).GetProperty("localToday").GetString()!);

    private static async Task<ApiClient> WithHabitAsync(ApiHost host)
    {
        var user = await host.SignedInAsync();
        await user.CreateHabitAsync();
        return user;
    }

    private static async Task ExpectFieldError(HttpResponseMessage response, string field)
        => (await response.ExpectProblem(HttpStatusCode.BadRequest, "validation")).GetProperty("errors").Has(field).Should().BeTrue();

    private static async Task<int> CreateMoodAsync(ApiClient user, string label = "Tired", object? encrypted = null)
        => (await (await user.Post("/api/moods", encrypted is null ? new { label } : new { encrypted })).ExpectJson(HttpStatusCode.Created))
            .GetProperty("id").GetInt32();

    private static async Task<JsonElement> JournalAsync(ApiClient user)
        => (await (await user.Get("/api/me")).ExpectJson()).GetProperty("journal");

    private static Task<HttpResponseMessage> DeleteKey(ApiClient user, bool discardEncrypted, string? secret = ApiClient.Passphrase)
        => user.Send(HttpMethod.Delete, "/api/me/journal-key", new DeleteKeyRequest(secret, discardEncrypted));

    [DockerFact]
    public async Task Put_and_get_keep_inner_line_breaks_and_a_replay_is_idempotent()
    {
        var user = await WithHabitAsync(Host);
        var today = (await TodayAsync(user)).Iso();
        var body = new { text = "  Slept badly.\nStill went for a walk.\n ", mood = "okay" };

        var saved = await (await user.Put($"/api/day-notes/{today}", body)).ExpectJson();
        await (await user.Put($"/api/day-notes/{today}", body)).Expect(HttpStatusCode.OK);

        saved.GetProperty("text").GetString().Should().Be("Slept badly.\nStill went for a walk.");
        var notes = (await (await user.Get("/api/day-notes")).ExpectJson()).EnumerateArray().ToList();
        notes.Should().ContainSingle();
        notes[0].GetProperty("date").GetString().Should().Be(today);
        notes[0].GetProperty("text").GetString().Should().Be("Slept badly.\nStill went for a walk.");
        notes[0].GetProperty("mood").GetString().Should().Be("okay");
    }

    [DockerFact]
    public async Task Text_over_2000_characters_after_trimming_is_rejected()
    {
        var user = await WithHabitAsync(Host);
        var today = (await TodayAsync(user)).Iso();

        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { text = new string('a', 2001) }), "text");
        await (await user.Put($"/api/day-notes/{today}", new { text = $"  {new string('a', 2000)}  " })).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Custom_mood_must_be_own_and_active_but_a_replay_may_keep_one_archived_since()
    {
        var user = await WithHabitAsync(Host);
        var other = await WithHabitAsync(Host);
        var today = (await TodayAsync(user)).Iso();
        var own = await CreateMoodAsync(user);
        var archived = await CreateMoodAsync(user, "Old");
        await (await user.Patch($"/api/moods/{archived}", new { archived = true })).Expect(HttpStatusCode.OK);
        var foreign = await CreateMoodAsync(other);

        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { mood = $"custom:{archived}" }), "mood");
        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { mood = $"custom:{foreign}" }), "mood");
        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { mood = "custom:999999" }), "mood");
        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { mood = "fine" }), "mood");
        (await (await user.Put($"/api/day-notes/{today}", new { mood = $"custom:{own}" })).ExpectJson())
            .GetProperty("mood").GetString().Should().Be($"custom:{own}");

        await (await user.Patch($"/api/moods/{own}", new { archived = true })).Expect(HttpStatusCode.OK);
        await (await user.Put($"/api/day-notes/{today}", new { mood = $"custom:{own}" })).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Put_with_neither_text_nor_mood_deletes_the_entry()
    {
        var user = await WithHabitAsync(Host);
        var today = (await TodayAsync(user)).Iso();
        await (await user.Put($"/api/day-notes/{today}", new { text = "Hello", mood = "good" })).Expect(HttpStatusCode.OK);

        var cleared = await (await user.Put($"/api/day-notes/{today}", new { text = "  \n ", mood = (string?)null })).ExpectJson();

        cleared.GetProperty("date").GetString().Should().Be(today);
        cleared.GetProperty("text").ValueKind.Should().Be(JsonValueKind.Null);
        cleared.GetProperty("mood").ValueKind.Should().Be(JsonValueKind.Null);
        (await (await user.Get("/api/day-notes")).ExpectJson()).GetArrayLength().Should().Be(0);
    }

    [DockerFact]
    public async Task Writes_need_consent_but_reads_and_delete_dont()
    {
        var user = await Host.SignedInAsync(consent: false);
        var today = (await TodayAsync(user)).Iso();

        await (await user.Put($"/api/day-notes/{today}", new { text = "Hi" })).ExpectProblem(HttpStatusCode.Forbidden, "consent_required");
        await (await user.Post("/api/moods", new { label = "Tired" })).ExpectProblem(HttpStatusCode.Forbidden, "consent_required");
        await (await user.Get("/api/day-notes")).Expect(HttpStatusCode.OK);
        await (await user.Get("/api/moods")).Expect(HttpStatusCode.OK);
        await (await user.Delete($"/api/day-notes/{today}")).Expect(HttpStatusCode.NoContent);
    }

    [DockerFact]
    public async Task Date_rules_follow_low_days_but_today_needs_no_habit()
    {
        var noHabits = await Host.SignedInAsync();
        var today = await TodayAsync(noHabits);
        await (await noHabits.Put($"/api/day-notes/{today.Iso()}", new { text = "Hi" })).Expect(HttpStatusCode.OK);
        await (await noHabits.Put($"/api/day-notes/{today.AddDays(-1).Iso()}", new { text = "Hi" }))
            .ExpectProblem(HttpStatusCode.UnprocessableEntity, "before_habit_start");

        var user = await WithHabitAsync(Host);
        await (await user.Put($"/api/day-notes/{today.AddDays(1).Iso()}", new { text = "Hi" }))
            .ExpectProblem(HttpStatusCode.UnprocessableEntity, "in_future");
        await (await user.Put($"/api/day-notes/{today.AddDays(-1).Iso()}", new { text = "Hi" }))
            .ExpectProblem(HttpStatusCode.UnprocessableEntity, "before_habit_start");
    }

    [DockerFact]
    public async Task An_existing_entry_can_be_rewritten_after_its_habits_are_gone_so_turning_the_journal_off_can_finish()
    {
        var user = await WithHabitAsync(Host);
        var today = (await TodayAsync(user)).Iso();
        await (await user.Put($"/api/day-notes/{today}", new { text = "Hi" })).Expect(HttpStatusCode.OK);
        foreach (var habit in (await (await user.Get("/api/habits")).ExpectJson()).EnumerateArray())
            await (await user.Delete($"/api/habits/{habit.GetProperty("id").GetInt32()}")).Expect(HttpStatusCode.NoContent);

        await (await user.Put($"/api/day-notes/{today}", new { text = "Hello" })).Expect(HttpStatusCode.OK);
        await (await user.Put($"/api/day-notes/{(await TodayAsync(user)).AddDays(-1).Iso()}", new { text = "New" }))
            .ExpectProblem(HttpStatusCode.UnprocessableEntity, "before_habit_start");
    }

    [DockerFact]
    public async Task Range_is_at_most_366_days_and_from_not_after_to()
    {
        var user = await Host.SignedInAsync();
        var today = await TodayAsync(user);

        await ExpectFieldError(await user.Get($"/api/day-notes?from={today.Iso()}&to={today.AddDays(-1).Iso()}"), "from");
        await ExpectFieldError(await user.Get($"/api/day-notes?from={today.AddDays(-366).Iso()}&to={today.Iso()}"), "from");
        await (await user.Get($"/api/day-notes?from={today.AddDays(-365).Iso()}&to={today.Iso()}")).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Moods_create_patch_clear_emoji_and_archive()
    {
        var user = await Host.SignedInAsync();
        var created = await (await user.Post("/api/moods", new { label = "  Tired  ", emoji = "😴" })).ExpectJson(HttpStatusCode.Created);
        var id = created.GetProperty("id").GetInt32();
        created.GetProperty("label").GetString().Should().Be("Tired");

        var renamed = await (await user.Patch($"/api/moods/{id}", new { label = "Sleepy" })).ExpectJson();
        renamed.GetProperty("emoji").GetString().Should().Be("😴");
        var cleared = await (await user.Patch($"/api/moods/{id}", new { emoji = (string?)null })).ExpectJson();
        cleared.GetProperty("emoji").ValueKind.Should().Be(JsonValueKind.Null);
        cleared.GetProperty("label").GetString().Should().Be("Sleepy");
        await (await user.Patch($"/api/moods/{id}", new { archived = true })).Expect(HttpStatusCode.OK);

        var mood = (await (await user.Get("/api/moods")).ExpectJson()).EnumerateArray().Single();
        mood.GetProperty("archived").GetBoolean().Should().BeTrue();
        mood.GetProperty("label").GetString().Should().Be("Sleepy");
        await (await (await Host.SignedInAsync()).Patch($"/api/moods/{id}", new { archived = false }))
            .ExpectProblem(HttpStatusCode.NotFound, "not_found");
    }

    [DockerFact]
    public async Task A_21st_active_mood_is_refused_on_create_and_on_unarchive()
    {
        var user = await Host.SignedInAsync();
        var first = await CreateMoodAsync(user, "Mood 0");
        for (var i = 1; i < 20; i++) await CreateMoodAsync(user, $"Mood {i}");

        await (await user.Post("/api/moods", new { label = "One more" })).ExpectProblem(HttpStatusCode.Conflict, "conflict");
        await (await user.Patch($"/api/moods/{first}", new { archived = true })).Expect(HttpStatusCode.OK);
        await CreateMoodAsync(user, "Replacement");
        await (await user.Patch($"/api/moods/{first}", new { archived = false })).ExpectProblem(HttpStatusCode.Conflict, "conflict");
    }

    [DockerFact]
    public async Task Emoji_must_be_one_emoji_grapheme()
    {
        var user = await Host.SignedInAsync();

        foreach (var emoji in new[] { "😴", "👍🏽", "🇩🇪", "1️⃣" })
            await (await user.Post("/api/moods", new { label = "Ok", emoji })).Expect(HttpStatusCode.Created);
        foreach (var emoji in new[] { "ab", "a", "😴😴", "" })
            await ExpectFieldError(await user.Post("/api/moods", new { label = "Bad", emoji }), "emoji");
    }

    [DockerFact]
    public async Task Creating_a_key_needs_the_correct_password()
    {
        var user = await Host.SignedInAsync();
        await (await user.Get("/api/me/journal-key")).ExpectProblem(HttpStatusCode.NotFound, "not_found");

        await ExpectFieldError(await user.Put("/api/me/journal-key", KeyBody(secret: null)), "password");
        await ExpectFieldError(await user.Put("/api/me/journal-key", KeyBody(secret: "wrong-passphrase")), "password");
        var created = await (await user.Put("/api/me/journal-key", KeyBody())).ExpectJson();

        created.GetProperty("version").GetInt32().Should().Be(1);
        created.GetProperty("turningOff").GetBoolean().Should().BeFalse();
        var stored = await (await user.Get("/api/me/journal-key")).ExpectJson();
        stored.GetProperty("passphrase").GetProperty("iterations").GetInt32().Should().Be(600_000);
        stored.GetProperty("recovery").GetProperty("wrapped").GetString().Should().Be(B64(48));
        stored.Has("password").Should().BeFalse();
    }

    [DockerFact]
    public async Task Replacing_needs_the_current_version_and_increments_it()
    {
        var user = await Host.SignedInAsync();
        await (await user.Put("/api/me/journal-key", KeyBody(ifVersion: 1))).ExpectProblem(HttpStatusCode.Conflict, "conflict");
        await (await user.Put("/api/me/journal-key", KeyBody())).Expect(HttpStatusCode.OK);

        await (await user.Put("/api/me/journal-key", KeyBody())).ExpectProblem(HttpStatusCode.Conflict, "conflict");
        await (await user.Put("/api/me/journal-key", KeyBody(ifVersion: 2))).ExpectProblem(HttpStatusCode.Conflict, "conflict");
        var replaced = await (await user.Put("/api/me/journal-key", KeyBody(ifVersion: 1, iterations: 700_000))).ExpectJson();

        replaced.GetProperty("version").GetInt32().Should().Be(2);
        replaced.GetProperty("passphrase").GetProperty("iterations").GetInt32().Should().Be(700_000);
        await (await user.Put("/api/me/journal-key", KeyBody(ifVersion: 1))).ExpectProblem(HttpStatusCode.Conflict, "conflict");
    }

    [DockerFact]
    public async Task Key_and_blob_sizes_are_checked()
    {
        var user = await WithHabitAsync(Host);
        var today = (await TodayAsync(user)).Iso();

        await ExpectFieldError(await user.Put("/api/me/journal-key", KeyBody(passphraseSalt: B64(15))), "passphrase.salt");
        await ExpectFieldError(await user.Put("/api/me/journal-key", KeyBody(iterations: 599_999)), "passphrase.iterations");
        await ExpectFieldError(await user.Put("/api/me/journal-key", KeyBody(recoveryWrapped: B64(32))), "recovery.wrapped");
        await (await user.Put("/api/me/journal-key", KeyBody())).Expect(HttpStatusCode.OK);

        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { encrypted = new { v = 1, iv = B64(16), ct = B64(32) } }), "encrypted.iv");
        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { encrypted = new { v = 1, iv = B64(12), ct = B64(15) } }), "encrypted.ct");
        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { encrypted = new { v = 1, iv = B64(12), ct = B64(12291) } }), "encrypted.ct");
        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { encrypted = new { v = 2, iv = B64(12), ct = B64(32) } }), "encrypted.v");
        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { encrypted = new { v = 1, iv = B64(12), ct = B64(30) + "\n   " } }), "encrypted.ct");
        await (await user.Put($"/api/day-notes/{today}", new { encrypted = new { v = 1, iv = B64(12), ct = B64(12288) } })).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task With_the_private_journal_on_todays_entry_without_habits_must_still_be_encrypted()
    {
        var user = await Host.SignedInAsync();
        var today = (await TodayAsync(user)).Iso();
        await (await user.Put("/api/me/journal-key", KeyBody())).Expect(HttpStatusCode.OK);

        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { text = "Plain" }), "encrypted");
        await (await user.Put($"/api/day-notes/{today}", new { encrypted = Blob })).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Encrypted_bodies_without_a_key_are_rejected()
    {
        var user = await WithHabitAsync(Host);
        var today = (await TodayAsync(user)).Iso();

        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { encrypted = Blob }), "encrypted");
        await ExpectFieldError(await user.Post("/api/moods", new { encrypted = Blob }), "encrypted");
    }

    [DockerFact]
    public async Task Turning_off_accepts_plaintext_again_and_the_key_goes_once_nothing_is_encrypted()
    {
        var user = await WithHabitAsync(Host);
        var today = (await TodayAsync(user)).Iso();
        var plainMood = await CreateMoodAsync(user, "Plain");
        await (await user.Put("/api/me/journal-key", KeyBody())).Expect(HttpStatusCode.OK);

        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { text = "Plain" }), "encrypted");
        await ExpectFieldError(await user.Post("/api/moods", new { label = "Plain" }), "encrypted");
        await ExpectFieldError(await user.Patch($"/api/moods/{plainMood}", new { label = "Renamed" }), "encrypted");
        await (await user.Patch($"/api/moods/{plainMood}", new { archived = true })).Expect(HttpStatusCode.OK);
        var note = await (await user.Put($"/api/day-notes/{today}", new { encrypted = Blob })).ExpectJson();
        note.GetProperty("encrypted").GetProperty("ct").GetString().Should().Be(B64(32));
        note.Has("text").Should().BeFalse();
        var secretMood = await CreateMoodAsync(user, encrypted: Blob);

        var turningOff = await (await user.Post("/api/me/journal-key/turn-off", new TurnOffRequest(ApiClient.Passphrase))).ExpectJson();
        turningOff.GetProperty("turningOff").GetBoolean().Should().BeTrue();
        (await JournalAsync(user)).GetProperty("turningOff").GetBoolean().Should().BeTrue();

        await (await user.Put($"/api/day-notes/{today}", new { text = "Decrypted" })).Expect(HttpStatusCode.OK);
        await (await DeleteKey(user, discardEncrypted: false)).ExpectProblem(HttpStatusCode.Conflict, "conflict");
        await (await user.Patch($"/api/moods/{secretMood}", new { label = "Decrypted", emoji = "😴" })).Expect(HttpStatusCode.OK);
        await (await DeleteKey(user, discardEncrypted: false)).Expect(HttpStatusCode.NoContent);

        await (await user.Get("/api/me/journal-key")).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        var journal = await JournalAsync(user);
        journal.GetProperty("encrypted").GetBoolean().Should().BeFalse();
        journal.GetProperty("plaintextLeft").GetInt32().Should().Be(3);
        journal.GetProperty("encryptedLeft").GetInt32().Should().Be(0);
    }

    [DockerFact]
    public async Task Turning_an_encrypted_entry_back_to_plaintext_may_use_an_own_archived_mood_but_not_a_foreign_one()
    {
        var user = await WithHabitAsync(Host);
        var other = await Host.SignedInAsync();
        var foreignMood = await CreateMoodAsync(other, "Foreign");
        var today = (await TodayAsync(user)).Iso();
        var plainMood = await CreateMoodAsync(user, "Plain");
        await (await user.Put("/api/me/journal-key", KeyBody())).Expect(HttpStatusCode.OK);
        await (await user.Put($"/api/day-notes/{today}", new { encrypted = Blob })).Expect(HttpStatusCode.OK);
        await (await user.Post("/api/me/journal-key/turn-off", new TurnOffRequest(ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        await (await user.Patch($"/api/moods/{plainMood}", new { archived = true })).Expect(HttpStatusCode.OK);

        await ExpectFieldError(await user.Put($"/api/day-notes/{today}", new { text = "Decrypted", mood = $"custom:{foreignMood}" }), "mood");
        var note = await (await user.Put($"/api/day-notes/{today}", new { text = "Decrypted", mood = $"custom:{plainMood}" })).ExpectJson();
        note.GetProperty("mood").GetString().Should().Be($"custom:{plainMood}");
        await (await DeleteKey(user, discardEncrypted: false)).Expect(HttpStatusCode.NoContent);
    }

    [DockerFact]
    public async Task Discarding_deletes_only_encrypted_entries_and_moods_with_the_key()
    {
        var user = await WithHabitAsync(Host);
        var day1 = await TodayAsync(user);
        await (await user.Put($"/api/day-notes/{day1.Iso()}", new { text = "Plain" })).Expect(HttpStatusCode.OK);
        await CreateMoodAsync(user, "Plain");
        await (await user.Put("/api/me/journal-key", KeyBody())).Expect(HttpStatusCode.OK);
        Host.Time.Advance(TimeSpan.FromDays(1));
        var day2 = day1.AddDays(1);
        await (await user.Put($"/api/day-notes/{day2.Iso()}", new { encrypted = Blob })).Expect(HttpStatusCode.OK);
        await CreateMoodAsync(user, encrypted: Blob);

        var journal = await JournalAsync(user);
        journal.GetProperty("encrypted").GetBoolean().Should().BeTrue();
        journal.GetProperty("turningOff").GetBoolean().Should().BeFalse();
        journal.GetProperty("plaintextLeft").GetInt32().Should().Be(2);
        journal.GetProperty("encryptedLeft").GetInt32().Should().Be(2);

        await (await DeleteKey(user, discardEncrypted: true)).Expect(HttpStatusCode.NoContent);

        var notes = (await (await user.Get("/api/day-notes")).ExpectJson()).EnumerateArray().ToList();
        notes.Select(n => n.GetProperty("date").GetString()).Should().Equal(day1.Iso());
        (await (await user.Get("/api/moods")).ExpectJson()).EnumerateArray().Select(m => m.GetProperty("label").GetString())
            .Should().Equal("Plain");
        (await Host.Db(db => db.JournalKeys.CountAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task Journal_key_changes_need_the_password_when_the_account_has_one()
    {
        var user = await Host.SignedInAsync();
        await (await user.Put("/api/me/journal-key", KeyBody())).Expect(HttpStatusCode.OK);

        await ExpectFieldError(await user.Post("/api/me/journal-key/turn-off", new TurnOffRequest("wrong-passphrase")), "password");
        await ExpectFieldError(await DeleteKey(user, discardEncrypted: true, secret: null), "password");
        (await Host.Db(db => db.JournalKeys.CountAsync())).Should().Be(1);
    }

    [DockerFact]
    public async Task A_discord_only_account_creates_and_replaces_its_key_without_a_password()
    {
        var user = Host.NewClient();
        await Host.DiscordAsync(user, "/api/auth/discord/login", ApiHost.NewDiscordId());
        await user.RefreshCsrfAsync();

        await (await user.Put("/api/me/journal-key", KeyBody(secret: null))).Expect(HttpStatusCode.OK);
        var replaced = await (await user.Put("/api/me/journal-key", KeyBody(secret: null, ifVersion: 1))).ExpectJson();

        replaced.GetProperty("version").GetInt32().Should().Be(2);
        await (await user.Post("/api/me/journal-key/turn-off", new TurnOffRequest(null))).Expect(HttpStatusCode.OK);
        await (await DeleteKey(user, discardEncrypted: false, secret: null)).Expect(HttpStatusCode.NoContent);
    }
}
