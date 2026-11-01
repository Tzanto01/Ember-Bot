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
        return root;
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
}
