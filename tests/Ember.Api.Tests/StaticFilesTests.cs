using System.Net;
using FluentAssertions;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class StaticFilesTests(PostgresFixture postgres) : ApiTestBase(postgres), IDisposable
{
    private readonly string _root = CreateWebRoot();

    protected override Dictionary<string, string?>? Settings => new() { ["Ember:WebRoot"] = _root };

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private static string CreateWebRoot()
    {
        var root = Directory.CreateTempSubdirectory("ember-webroot-").FullName;
        File.WriteAllText(Path.Combine(root, "index.html"), "<html>ember-index</html>");
        Directory.CreateDirectory(Path.Combine(root, "legal"));
        File.WriteAllText(Path.Combine(root, "legal", "privacy.md"), "# Privacy");
        Directory.CreateDirectory(Path.Combine(root, "assets"));
        File.WriteAllText(Path.Combine(root, "assets", "index-abc123.js"), "console.log(1)");
        File.WriteAllText(Path.Combine(root, "sw.js"), "self");
        File.WriteAllText(Path.Combine(root, "release-notes.json"), "[]");
        return root;
    }

    [DockerFact]
    public async Task The_app_reads_release_notes_cross_origin_but_no_other_static_file()
    {
        var client = Host.NewClient();

        foreach (var (path, allowed) in new (string, string?)[] { ("/release-notes.json", "https://localhost"), ("/legal/privacy.md", null) })
        {
            var request = new HttpRequestMessage(HttpMethod.Get, path);
            request.Headers.Add("Origin", "https://localhost");

            var response = await client.Http.SendAsync(request);

            response.StatusCode.Should().Be(HttpStatusCode.OK, path);
            (response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values) ? values.Single() : null).Should().Be(allowed, path);
        }
    }

    [DockerFact]
    public async Task Static_files_come_from_the_web_root_and_markdown_is_served_as_text_markdown()
    {
        var response = await Host.NewClient().Get("/legal/privacy.md");

        (await response.Expect(HttpStatusCode.OK)).Should().Be("# Privacy");
        response.Content.Headers.ContentType?.MediaType.Should().Be("text/markdown");
    }

    [DockerFact]
    public async Task Unknown_web_routes_fall_back_to_index_html_but_unknown_api_paths_stay_a_json_404()
    {
        var client = Host.NewClient();

        (await (await client.Get("/some/route")).Expect(HttpStatusCode.OK)).Should().Contain("ember-index");
        await (await client.Get("/api/nope")).ExpectProblem(HttpStatusCode.NotFound, "not_found");
    }

    [DockerFact]
    public async Task Only_the_landing_page_and_static_files_outside_legal_may_be_indexed()
    {
        var client = Host.NewClient();

        foreach (var path in new[] { "/legal/imprint", "/legal/privacy.md", "/today", "/login", "/api/me", "/health" })
            (await RobotsTag(client, path)).Should().Be("noindex", path);
        foreach (var path in new[] { "/", "/assets/index-abc123.js", "/sw.js" })
            (await RobotsTag(client, path)).Should().BeNull(path);
    }

    private static async Task<string?> RobotsTag(ApiClient client, string path)
    {
        var response = await client.Get(path);
        return response.Headers.TryGetValues("X-Robots-Tag", out var values) ? string.Join(", ", values) : null;
    }

    [DockerFact]
    public async Task Hashed_assets_are_cached_for_a_year_and_everything_else_is_revalidated()
    {
        var client = Host.NewClient();

        (await client.Get("/assets/index-abc123.js")).Headers.CacheControl!.ToString().Should().Be("public, max-age=31536000, immutable");
        foreach (var path in new[] { "/", "/today", "/index.html", "/sw.js", "/legal/privacy.md" })
            (await client.Get(path)).Headers.CacheControl!.NoCache.Should().BeTrue(path);
    }
}
