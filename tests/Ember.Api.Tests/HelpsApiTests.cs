using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

/// <summary>The end-to-end encrypted "What helps me" list, <c>/api/me/helps</c> (contract "Companion extras v1.17").</summary>
[Collection("Postgres")]
public class HelpsApiTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private sealed record KeyRequest(object Passphrase, object Recovery, string? Password, int? IfVersion);

    private static string B64(int bytes) => Convert.ToBase64String(Enumerable.Repeat((byte)7, bytes).ToArray());

    private static readonly KeyRequest Key = new(
        new { salt = B64(16), iterations = 600_000, iv = B64(12), wrapped = B64(48) },
        new { salt = B64(16), iv = B64(12), wrapped = B64(48) },
        ApiClient.Passphrase, null);

    private static async Task<ApiClient> WithJournalAsync(ApiHost host, bool consent = true)
    {
        var user = await host.SignedInAsync(consent);
        await (await user.Put("/api/me/journal-key", Key)).Expect(HttpStatusCode.OK);
        return user;
    }

    private static Task<HttpResponseMessage> PutHelps(ApiClient user, string encrypted, int version)
        => user.Put("/api/me/helps", new { encrypted, version });

    private static async Task<int> VersionAsync(HttpResponseMessage response)
        => (await response.ExpectJson()).GetProperty("version").GetInt32();

    private Task<int> HelpsRowsAsync(Guid userId) => Host.Db(db => db.UserHelps.CountAsync(h => h.UserId == userId));

    [DockerFact]
    public async Task Put_and_get_round_trip_and_each_save_needs_the_version_last_read()
    {
        var user = await WithJournalAsync(Host);
        await (await user.Get("/api/me/helps")).ExpectProblem(HttpStatusCode.NotFound, "not_found");

        (await VersionAsync(await PutHelps(user, "first", 0))).Should().Be(1);
        await (await PutHelps(user, "again from zero", 0)).ExpectProblem(HttpStatusCode.Conflict, "conflict");
        (await VersionAsync(await PutHelps(user, "second", 1))).Should().Be(2);
        await (await PutHelps(user, "stale", 1)).ExpectProblem(HttpStatusCode.Conflict, "conflict");
        await (await PutHelps(user, "ahead", 3)).ExpectProblem(HttpStatusCode.Conflict, "conflict");

        var stored = await (await user.Get("/api/me/helps")).ExpectJson();
        stored.GetProperty("encrypted").GetString().Should().Be("second");
        stored.GetProperty("version").GetInt32().Should().Be(2);
    }

    [DockerFact]
    public async Task Concurrent_saves_from_the_same_version_let_exactly_one_win()
    {
        var user = await WithJournalAsync(Host);
        await (await PutHelps(user, "base", 0)).Expect(HttpStatusCode.OK);

        var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(i => PutHelps(user, $"device {i}", 1)));

        responses.Count(r => r.StatusCode == HttpStatusCode.OK).Should().Be(1);
        responses.Count(r => r.StatusCode == HttpStatusCode.Conflict).Should().Be(5);
        (await (await user.Get("/api/me/helps")).ExpectJson()).GetProperty("version").GetInt32().Should().Be(2);
    }

    [DockerFact]
    public async Task Saving_needs_the_private_journal_on_and_not_turning_off()
    {
        var user = await Host.SignedInAsync();
        await (await PutHelps(user, "no journal", 0)).ExpectProblem(HttpStatusCode.Conflict, "conflict");

        await (await user.Put("/api/me/journal-key", Key)).Expect(HttpStatusCode.OK);
        await (await PutHelps(user, "on", 0)).Expect(HttpStatusCode.OK);
        await (await user.Post("/api/me/journal-key/turn-off", new { password = ApiClient.Passphrase })).Expect(HttpStatusCode.OK);

        await (await PutHelps(user, "turning off", 1)).ExpectProblem(HttpStatusCode.Conflict, "conflict");
        (await (await user.Get("/api/me/helps")).ExpectJson()).GetProperty("encrypted").GetString().Should().Be("on");
    }

    [DockerFact]
    public async Task Encrypted_is_at_most_16_KiB_and_version_must_be_given()
    {
        var user = await WithJournalAsync(Host);

        var tooLong = await (await PutHelps(user, new string('a', 16 * 1024 + 1), 0)).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var empty = await (await PutHelps(user, "", 0)).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var noVersion = await (await user.Put("/api/me/helps", new { encrypted = "x" })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var negative = await (await PutHelps(user, "x", -1)).ExpectProblem(HttpStatusCode.BadRequest, "validation");

        tooLong.GetProperty("errors").Has("encrypted").Should().BeTrue();
        empty.GetProperty("errors").Has("encrypted").Should().BeTrue();
        noVersion.GetProperty("errors").Has("version").Should().BeTrue();
        negative.GetProperty("errors").Has("version").Should().BeTrue();
        await (await PutHelps(user, new string('a', 16 * 1024), 0)).Expect(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Saving_needs_consent_but_reading_and_deleting_dont()
    {
        var user = await WithJournalAsync(Host, consent: false);

        await (await PutHelps(user, "x", 0)).ExpectProblem(HttpStatusCode.Forbidden, "consent_required");
        await (await user.Get("/api/me/helps")).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await user.Delete("/api/me/helps")).Expect(HttpStatusCode.NoContent);
    }

    [DockerFact]
    public async Task Delete_removes_the_list_and_is_idempotent_and_a_new_list_starts_again_from_zero()
    {
        var user = await WithJournalAsync(Host);
        await (await PutHelps(user, "x", 0)).Expect(HttpStatusCode.OK);

        await (await user.Delete("/api/me/helps")).Expect(HttpStatusCode.NoContent);
        await (await user.Delete("/api/me/helps")).Expect(HttpStatusCode.NoContent);

        await (await user.Get("/api/me/helps")).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        (await VersionAsync(await PutHelps(user, "y", 0))).Should().Be(1);
    }

    [DockerFact]
    public async Task Finishing_a_turn_off_deletes_the_list()
    {
        var user = await WithJournalAsync(Host);
        await (await PutHelps(user, "x", 0)).Expect(HttpStatusCode.OK);
        await (await user.Post("/api/me/journal-key/turn-off", new { password = ApiClient.Passphrase })).Expect(HttpStatusCode.OK);

        await (await user.Send(HttpMethod.Delete, "/api/me/journal-key", new { password = ApiClient.Passphrase, discardEncrypted = false }))
            .Expect(HttpStatusCode.NoContent);

        await (await user.Get("/api/me/helps")).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        (await HelpsRowsAsync(await user.IdAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task Discarding_the_journal_deletes_the_list_but_a_refused_finish_keeps_it()
    {
        var user = await WithJournalAsync(Host);
        await user.CreateHabitAsync();
        var today = (await (await user.Get("/api/me")).ExpectJson()).GetProperty("localToday").GetString();
        await (await user.Put($"/api/day-notes/{today}", new { encrypted = new { v = 1, iv = B64(12), ct = B64(32) } })).Expect(HttpStatusCode.OK);
        await (await PutHelps(user, "x", 0)).Expect(HttpStatusCode.OK);

        await (await user.Send(HttpMethod.Delete, "/api/me/journal-key", new { password = ApiClient.Passphrase, discardEncrypted = false }))
            .ExpectProblem(HttpStatusCode.Conflict, "conflict");
        (await HelpsRowsAsync(await user.IdAsync())).Should().Be(1);

        await (await user.Send(HttpMethod.Delete, "/api/me/journal-key", new { password = ApiClient.Passphrase, discardEncrypted = true }))
            .Expect(HttpStatusCode.NoContent);
        (await HelpsRowsAsync(await user.IdAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task Deleting_the_account_deletes_the_list()
    {
        var user = await WithJournalAsync(Host);
        var userId = await user.IdAsync();
        await (await PutHelps(user, "x", 0)).Expect(HttpStatusCode.OK);

        await (await user.Post("/api/me/delete", new DeleteRequest(ApiClient.Passphrase, null))).Expect(HttpStatusCode.NoContent);

        (await HelpsRowsAsync(userId)).Should().Be(0);
    }

    [DockerFact]
    public async Task The_json_export_has_the_ciphertext_and_the_csv_a_helps_row()
    {
        var user = await WithJournalAsync(Host);
        using var empty = JsonDocument.Parse(await (await user.Get("/api/me/export?format=json")).Expect(HttpStatusCode.OK));
        await (await PutHelps(user, "aGVscHM=", 0)).Expect(HttpStatusCode.OK);

        using var json = JsonDocument.Parse(await (await user.Get("/api/me/export?format=json")).Expect(HttpStatusCode.OK));
        var csv = await (await user.Get("/api/me/export?format=csv")).Expect(HttpStatusCode.OK);

        empty.RootElement.GetProperty("helps_encrypted").ValueKind.Should().Be(JsonValueKind.Null);
        json.RootElement.GetProperty("helps_encrypted").GetString().Should().Be("aGVscHM=");
        csv.Split("\r\n").Should().ContainSingle(l => l.StartsWith("helps,") && l.EndsWith(",aGVscHM=,"));
    }
}
