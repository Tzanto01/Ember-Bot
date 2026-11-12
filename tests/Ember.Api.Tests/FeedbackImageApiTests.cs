using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class FeedbackImageApiTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string Url = "/api/feedback";

    private static object Body(string?[]? images = null, bool? anonymous = null, string? title = "Crash on start", string? text = "It closes right away")
        => new { title, text, platform = "web", version = "1.2.3", images, anonymous };

    private Task<List<Feedback>> Stored() => Host.Db(db => db.Feedback.AsNoTracking().Include(f => f.Images).OrderBy(f => f.Id).ToListAsync());

    private static string B64(byte[] data) => SyntheticImages.Base64(data);

    [DockerFact]
    public async Task A_signed_in_post_with_two_pictures_stores_them_stripped_with_their_sniffed_types_in_upload_order()
    {
        var user = await Host.SignedInAsync(consent: false);

        await (await user.Post(Url, Body([B64(SyntheticImages.Jpeg(metadata: true, trailing: true)), B64(SyntheticImages.Png(metadata: true))])))
            .Expect(HttpStatusCode.NoContent);

        var item = (await Stored()).Should().ContainSingle().Subject;
        item.UserId.Should().Be(await user.IdAsync());
        item.Title.Should().Be("Crash on start");
        var images = item.Images.OrderBy(i => i.Id).ToList();
        images.Select(i => i.ContentType).Should().Equal("image/jpeg", "image/png");
        images[0].Data.Should().Equal(SyntheticImages.Jpeg());
        images[1].Data.Should().Equal(SyntheticImages.Png());
        images.Select(i => i.Size).Should().Equal(images.Select(i => i.Data.Length));
    }

    [DockerFact]
    public async Task Anonymous_true_stores_no_user_and_still_keeps_the_pictures()
    {
        var user = await Host.SignedInAsync(consent: false);

        await (await user.Post(Url, Body([B64(SyntheticImages.WebP())], anonymous: true))).Expect(HttpStatusCode.NoContent);

        var item = (await Stored()).Should().ContainSingle().Subject;
        item.UserId.Should().BeNull();
        item.Images.Should().ContainSingle().Which.ContentType.Should().Be("image/webp");
    }

    [DockerFact]
    public async Task An_anonymous_caller_with_pictures_is_rejected_on_images_and_nothing_is_stored()
    {
        var response = await Host.NewClient().Post(Url, Body([B64(SyntheticImages.Jpeg())]));

        var problem = await response.ExpectProblem(HttpStatusCode.BadRequest, "validation");
        problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).Should().Equal("images");
        (await Stored()).Should().BeEmpty();
    }

    [DockerFact]
    public async Task Six_pictures_or_a_picture_that_is_not_jpeg_png_or_webp_are_rejected_on_images_and_nothing_is_stored()
    {
        var user = await Host.SignedInAsync(consent: false);
        var one = B64(SyntheticImages.Jpeg());

        foreach (var images in new[] { Enumerable.Repeat(one, 6).ToArray(), [B64(SyntheticImages.Gif())], [B64(SyntheticImages.Polyglot())], ["not base64!"] })
        {
            var problem = await (await user.Post(Url, Body(images))).ExpectProblem(HttpStatusCode.BadRequest, "validation");
            problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).Should().Equal("images");
        }

        (await Stored()).Should().BeEmpty();
    }

    [DockerFact]
    public async Task An_empty_title_is_required_and_a_title_with_a_line_break_is_refused()
    {
        foreach (var title in new[] { "", "   ", "two\nlines" })
        {
            var problem = await (await Host.NewClient().Post(Url, Body(title: title))).ExpectProblem(HttpStatusCode.BadRequest, "validation");
            problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).Should().Equal("title");
        }

        (await Stored()).Should().BeEmpty();
    }

    [DockerFact]
    public async Task A_missing_title_from_an_older_app_is_taken_from_the_first_line_of_the_text()
    {
        await (await Host.NewClient().Post(Url, new { text = "Dark mode please\nIt hurts at night", platform = "web" })).Expect(HttpStatusCode.NoContent);

        (await Stored()).Should().ContainSingle().Which.Title.Should().Be("Dark mode please");
    }

    [DockerFact]
    public async Task A_title_is_stored_trimmed_and_100_characters_are_accepted_but_101_are_not()
    {
        await (await Host.NewClient().Post(Url, Body(title: "  " + new string('t', 100) + " "))).Expect(HttpStatusCode.NoContent);
        var problem = await (await Host.NewClient().Post(Url, Body(title: new string('t', 101)))).ExpectProblem(HttpStatusCode.BadRequest, "validation");

        problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).Should().Equal("title");
        (await Stored()).Should().ContainSingle().Which.Title.Should().Be(new string('t', 100));
    }

    [DockerFact]
    public async Task A_user_over_the_30_MiB_daily_picture_budget_gets_a_429_and_nothing_more_is_stored()
    {
        var user = await Host.SignedInAsync(consent: false);
        var big = B64(SyntheticImages.Jpeg(entropyBytes: 9 * 1024 * 1024));

        for (var i = 0; i < 3; i++) await (await user.Post(Url, Body([big]))).Expect(HttpStatusCode.NoContent);
        var limited = await user.Post(Url, Body([big]));

        await limited.ExpectProblem((HttpStatusCode)429, "rate_limited");
        limited.Headers.RetryAfter.Should().NotBeNull();
        (await Stored()).Should().HaveCount(3);
        var other = await Host.SignedInAsync(consent: false);
        await (await other.Post(Url, Body([big]))).Expect(HttpStatusCode.NoContent);
    }

    [DockerFact]
    public async Task Deleting_the_account_removes_the_images_of_its_signed_in_reports_and_keeps_those_of_its_anonymous_ones()
    {
        var user = await Host.SignedInAsync(consent: false);
        var picture = B64(SyntheticImages.Jpeg());
        await (await user.Post(Url, Body([picture], title: "signed"))).Expect(HttpStatusCode.NoContent);
        await (await user.Post(Url, Body([picture], anonymous: true, title: "anon"))).Expect(HttpStatusCode.NoContent);

        await (await user.Post("/api/me/delete", new DeleteRequest(ApiClient.Passphrase, "DELETE"))).Expect(HttpStatusCode.NoContent);

        var item = (await Stored()).Should().ContainSingle().Subject;
        item.Title.Should().Be("anon");
        item.Images.Should().ContainSingle();
        (await Host.Db(db => db.FeedbackImages.CountAsync())).Should().Be(1);
    }

    [DockerFact]
    public async Task On_a_real_server_an_anonymous_body_over_64_KiB_is_refused_while_a_signed_in_one_with_a_large_picture_is_accepted()
    {
        Host.UseKestrel(0);
        var user = await KestrelUserAsync();

        var anonymous = await Host.CreateClient().PostAsJsonAsync(Url, Body(text: new string('x', 100 * 1024)));
        var large = B64(SyntheticImages.Jpeg(entropyBytes: 750 * 1024));
        var signedIn = await user.PostAsJsonAsync(Url, Body([large]));

        anonymous.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        await signedIn.Expect(HttpStatusCode.NoContent);
        (await Stored()).Should().ContainSingle().Which.Images.Should().ContainSingle().Which.Size.Should().BeGreaterThan(700 * 1024);
    }

    private async Task<HttpClient> KestrelUserAsync()
    {
        var http = Host.CreateClient();
        var email = ApiHost.NewEmail();
        await (await http.PostAsJsonAsync("/api/auth/register", new Credentials(email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        var link = await Host.OldConfirmLinkAsync((await Host.Mail.WaitForAsync(email, 1)).Single());
        await (await http.PostAsJsonAsync("/api/auth/confirmEmail", new ConfirmRequest(link.UserId, link.Code, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);
        var tokens = await (await http.PostAsJsonAsync("/api/auth/login", new Credentials(email, ApiClient.Passphrase))).ExpectJson();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());
        return http;
    }
}

[Collection("Postgres")]
public class FeedbackImageDigestTests(PostgresFixture postgres) : FeedbackDigestTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new() { ["Feedback:DigestTo"] = Recipient };

    private Task Report(string title, int pictures, Guid? userId = null)
        => Host.Run(s => s.SaveFeedbackAsync(userId, "web", "1.0", "body of " + title, default, title,
            Enumerable.Range(0, pictures).Select(_ => new FeedbackImage { ContentType = "image/jpeg", Data = SyntheticImages.Jpeg() }).ToList()));

    private Task<List<FeedbackImage>> Pictures() => Host.Db(db => db.FeedbackImages.AsNoTracking().OrderBy(i => i.Id).ToListAsync());

    [DockerFact]
    public async Task The_digest_lists_picture_ids_and_the_anonymous_marker_but_never_attaches_or_names_a_command()
    {
        await Report("With pictures", 2);
        await Report("Without", 0);

        await RunDigest();

        var mail = Transport.Sent.Should().ContainSingle().Subject;
        var ids = (await Pictures()).Select(i => i.Id.ToString()).ToList();
        mail.Body.Should().Contain($"Pictures: {ids[0]}, {ids[1]}").And.Contain("> With pictures").And.Contain("anonymous");
        mail.Body.Split("Pictures:").Should().HaveCount(2, "only the report with pictures has the line");
        mail.Body.Should().NotContain("docker").And.NotContain("Ember.Api.dll");
    }

    [DockerFact]
    public async Task Pictures_are_deleted_30_days_after_the_report_was_resolved_and_not_before_or_when_unresolved()
    {
        await Report("old", 1);
        await Report("recent", 1);
        await Report("open", 1);
        var now = Host.Time.GetUtcNow().UtcDateTime;
        await Host.Db(db => db.Feedback.Where(f => f.Title == "old").ExecuteUpdateAsync(s => s.SetProperty(f => f.ResolvedAt, now.AddDays(-31))));
        await Host.Db(db => db.Feedback.Where(f => f.Title == "recent").ExecuteUpdateAsync(s => s.SetProperty(f => f.ResolvedAt, now.AddDays(-10))));

        await RunDigest();

        var left = await Host.Db(db => db.Feedback.Where(f => f.Images.Any()).Select(f => f.Title).OrderBy(t => t).ToListAsync());
        left.Should().Equal("open", "recent");
        (await Stored()).Should().HaveCount(3, "the reports themselves stay");
    }
}
