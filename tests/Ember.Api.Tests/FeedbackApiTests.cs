using System.Net;
using System.Net.Http.Headers;
using System.Text;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class FeedbackApiTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string Url = "/api/feedback";

    private static object Body(string? text = "Great app", string? platform = "web", string? version = "1.2.3")
        => new { text, platform, version };

    private Task<List<Ember.Core.Models.Feedback>> Stored()
        => Host.Db(db => db.Feedback.AsNoTracking().ToListAsync());

    private static async Task<HttpResponseMessage> PostRaw(ApiClient client, string json)
        => await client.Http.PostAsync(Url, new StringContent(json, Encoding.UTF8, new MediaTypeHeaderValue("application/json")));

    private async Task ExpectRejected(HttpResponseMessage response, string field)
    {
        var problem = await response.ExpectProblem(HttpStatusCode.BadRequest, "validation");
        problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).Should().Equal(field);
        (await Stored()).Should().BeEmpty();
    }

    [DockerFact]
    public async Task An_anonymous_post_returns_204_and_is_stored_without_a_user()
    {
        var response = await Host.NewClient().Post(Url, Body("Great app", "android", "1.2.3"));

        await response.Expect(HttpStatusCode.NoContent);
        var item = (await Stored()).Should().ContainSingle().Subject;
        item.UserId.Should().BeNull();
        (item.Text, item.Platform, item.Version).Should().Be(("Great app", "android", "1.2.3"));
        item.DigestedAt.Should().BeNull();
        item.CreatedAt.Should().Be(Host.Time.GetUtcNow().UtcDateTime);
    }

    [DockerFact]
    public async Task A_cookie_signed_in_post_is_stored_with_the_users_id()
    {
        var user = await Host.SignedInAsync(consent: false);

        await (await user.Post(Url, Body())).Expect(HttpStatusCode.NoContent);

        (await Stored()).Should().ContainSingle().Which.UserId.Should().Be(await user.IdAsync());
    }

    [DockerFact]
    public async Task A_cookie_post_without_the_antiforgery_token_is_refused_and_not_stored()
    {
        var user = await Host.SignedInAsync(consent: false);
        user.Csrf = null;

        var response = await user.Post(Url, Body());

        response.IsSuccessStatusCode.Should().BeFalse();
        (await Stored()).Should().BeEmpty();
    }

    [DockerFact]
    public async Task A_bearer_post_is_stored_with_the_users_id()
    {
        var user = await Host.ConfirmedUserAsync();
        var tokens = await (await user.Post("/api/auth/login", new Credentials(user.Email, ApiClient.Passphrase))).ExpectJson();
        var bearer = Host.NewClient();
        bearer.Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());

        await (await bearer.Post(Url, Body())).Expect(HttpStatusCode.NoContent);

        (await Stored()).Should().ContainSingle().Which.UserId.Should().Be(await bearer.IdAsync());
    }

    [DockerFact]
    public async Task The_text_is_stored_trimmed_with_inner_line_breaks_kept()
    {
        await (await Host.NewClient().Post(Url, Body("  first line\n\tsecond line \r\n "))).Expect(HttpStatusCode.NoContent);

        (await Stored()).Should().ContainSingle().Which.Text.Should().Be("first line\n\tsecond line");
    }

    [DockerFact]
    public async Task A_text_of_exactly_2000_characters_is_accepted()
    {
        await (await Host.NewClient().Post(Url, Body(new string('x', 2000)))).Expect(HttpStatusCode.NoContent);

        (await Stored()).Should().ContainSingle().Which.Text.Should().HaveLength(2000);
    }

    [DockerFact]
    public async Task A_missing_version_is_accepted_and_stored_as_none()
    {
        await (await PostRaw(Host.NewClient(), """{"text":"hi","platform":"web"}""")).Expect(HttpStatusCode.NoContent);

        (await Stored()).Should().ContainSingle().Which.Version.Should().BeNull();
    }

    [DockerFact]
    public async Task Members_other_than_text_platform_and_version_are_ignored_and_not_stored()
    {
        var body = new { text = "hi", platform = "web", version = "1.0", habits = new[] { new { name = "Water" } }, userId = Guid.NewGuid(), digestedAt = "2020-01-01T00:00:00Z", id = 99 };

        await (await Host.NewClient().Post(Url, body)).Expect(HttpStatusCode.NoContent);

        var item = (await Stored()).Should().ContainSingle().Subject;
        (item.Id, item.UserId, item.DigestedAt, item.Text, item.Platform, item.Version).Should().Be((item.Id, (Guid?)null, (DateTime?)null, "hi", "web", "1.0"));
        item.Id.Should().NotBe(99);
        (await Host.Db(db => db.Habits.CountAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task An_empty_text_is_rejected_on_text()
        => await ExpectRejected(await Host.NewClient().Post(Url, Body("")), "text");

    [DockerFact]
    public async Task A_whitespace_only_text_is_rejected_on_text()
        => await ExpectRejected(await Host.NewClient().Post(Url, Body(" \n\t  ")), "text");

    [DockerFact]
    public async Task A_missing_text_is_rejected_on_text()
        => await ExpectRejected(await PostRaw(Host.NewClient(), """{"platform":"web"}"""), "text");

    [DockerFact]
    public async Task A_text_of_2001_characters_is_rejected_on_text()
        => await ExpectRejected(await Host.NewClient().Post(Url, Body(new string('x', 2001))), "text");

    [DockerFact]
    public async Task Padding_whitespace_does_not_count_toward_the_length_limit()
    {
        await (await Host.NewClient().Post(Url, Body("  " + new string('x', 2000) + "  "))).Expect(HttpStatusCode.NoContent);

        (await Stored()).Should().ContainSingle();
    }

    [DockerFact]
    public async Task A_text_with_a_NUL_character_is_rejected_on_text()
        => await ExpectRejected(await Host.NewClient().Post(Url, Body("hello\0world")), "text");

    [DockerFact]
    public async Task A_text_with_an_unpaired_surrogate_is_rejected_with_a_validation_problem()
    {
        var response = await PostRaw(Host.NewClient(), """{"text":"bad \ud800 text","platform":"web"}""");

        await response.ExpectProblem(HttpStatusCode.BadRequest, "validation");
        (await Stored()).Should().BeEmpty();
    }

    [DockerFact]
    public async Task A_text_with_an_emoji_is_accepted()
    {
        await (await Host.NewClient().Post(Url, Body("Love it \U0001F525"))).Expect(HttpStatusCode.NoContent);

        (await Stored()).Should().ContainSingle().Which.Text.Should().Be("Love it \U0001F525");
    }

    [DockerFact]
    public async Task An_unknown_platform_is_rejected_on_platform()
        => await ExpectRejected(await Host.NewClient().Post(Url, Body(platform: "ios")), "platform");

    [DockerFact]
    public async Task The_discord_platform_is_rejected_on_platform()
        => await ExpectRejected(await Host.NewClient().Post(Url, Body(platform: "discord")), "platform");

    [DockerFact]
    public async Task A_missing_platform_is_rejected_on_platform()
        => await ExpectRejected(await Host.NewClient().Post(Url, Body(platform: null)), "platform");

    [DockerFact]
    public async Task A_version_with_disallowed_characters_is_rejected_on_version()
        => await ExpectRejected(await Host.NewClient().Post(Url, Body(version: "1.0 beta<script>")), "version");

    [DockerFact]
    public async Task An_empty_version_is_rejected_on_version()
        => await ExpectRejected(await Host.NewClient().Post(Url, Body(version: "")), "version");

    [DockerFact]
    public async Task A_version_of_33_characters_is_rejected_on_version()
        => await ExpectRejected(await Host.NewClient().Post(Url, Body(version: new string('1', 33))), "version");

    [DockerFact]
    public async Task A_version_of_32_characters_with_every_allowed_symbol_is_accepted()
    {
        var version = "Az09.+_-" + new string('1', 24);

        await (await Host.NewClient().Post(Url, Body(version: version))).Expect(HttpStatusCode.NoContent);

        (await Stored()).Should().ContainSingle().Which.Version.Should().Be(version);
    }

    [DockerFact]
    public async Task Every_invalid_field_is_reported_in_one_answer()
    {
        var problem = await (await Host.NewClient().Post(Url, Body("", "discord", "bad version"))).ExpectProblem(HttpStatusCode.BadRequest, "validation");

        problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).Should().BeEquivalentTo("text", "platform", "version");
    }

    [DockerFact]
    public async Task Deleting_the_account_removes_its_feedback_and_keeps_others()
    {
        var user = await Host.SignedInAsync(consent: false);
        await (await user.Post(Url, Body("mine"))).Expect(HttpStatusCode.NoContent);
        await (await Host.NewClient().Post(Url, Body("anonymous"))).Expect(HttpStatusCode.NoContent);

        await (await user.Post("/api/me/delete", new DeleteRequest(ApiClient.Passphrase, "DELETE"))).Expect(HttpStatusCode.NoContent);

        (await Stored()).Should().ContainSingle().Which.Text.Should().Be("anonymous");
    }
}
