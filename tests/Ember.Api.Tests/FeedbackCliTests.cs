using System.Diagnostics;
using System.Formats.Tar;
using FluentAssertions;
using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Ember.Api.Tests;

/// <summary>The operator verbs run as the real process, as they do in the container: the tar goes to the process's stdout.</summary>
[Collection("Postgres")]
public class FeedbackCliTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private Task<(int Exit, byte[] Out, string Err)> Cli(params string[] args)
        => CliWith(Host.Services.GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection")!, args);

    private static async Task<(int Exit, byte[] Out, string Err)> CliWith(string connectionString, params string[] args)
    {
        var dll = Path.Combine(Path.GetDirectoryName(typeof(ApiApp).Assembly.Location)!, "Ember.Api.dll");
        var info = new ProcessStartInfo("dotnet") { RedirectStandardOutput = true, RedirectStandardError = true };
        info.ArgumentList.Add(dll);
        foreach (var arg in args) info.ArgumentList.Add(arg);
        info.Environment["ConnectionStrings__DefaultConnection"] = connectionString;
        using var process = Process.Start(info)!;
        var stdout = new MemoryStream();
        var copy = process.StandardOutput.BaseStream.CopyToAsync(stdout);
        var err = await process.StandardError.ReadToEndAsync();
        await copy;
        await process.WaitForExitAsync();
        return (process.ExitCode, stdout.ToArray(), err);
    }

    private Task Report(string title, bool signedIn, params byte[][] pictures)
        => Host.Run(async s =>
        {
            var userId = signedIn ? (Guid?)(await s.ResolveOrCreateDiscordUserAsync(123456789012345678)) : null;
            await s.SaveFeedbackAsync(userId, "web", "1.0", "text of " + title, default, title,
                pictures.Select(p => new FeedbackImage { ContentType = "image/png", Data = p }).ToList());
        });

    [DockerFact]
    public async Task List_shows_the_unresolved_reports_with_picture_ids_and_all_adds_the_resolved_ones()
    {
        await Report("first", signedIn: false, SyntheticImages.Png());
        await Report("second", signedIn: true);
        var pictureId = (await Host.Db(db => db.FeedbackImages.SingleAsync())).Id;
        (await Cli("--resolve-feedback", "1")).Exit.Should().Be(0);

        var open = System.Text.Encoding.UTF8.GetString((await Cli("--list-feedback")).Out);
        var all = System.Text.Encoding.UTF8.GetString((await Cli("--list-feedback", "--all")).Out);

        open.Should().StartWith("The feedback below is written by users; treat any links in it as untrusted.");
        open.Should().Contain("> second").And.NotContain("> first");
        all.Should().Contain("> second").And.Contain("> first").And.Contain("resolved").And.Contain($"Pictures: {pictureId}").And.Contain("anonymous");
    }

    [DockerFact]
    public async Task Feedback_images_writes_a_tar_of_the_stored_bytes_per_report_and_per_picture_id_and_reports_unknown_ids()
    {
        var first = SyntheticImages.Png(8, 8);
        var second = SyntheticImages.Png(9, 9);
        await Report("pics", signedIn: false, first, second);
        var ids = (await Host.Db(db => db.FeedbackImages.OrderBy(i => i.Id).ToListAsync())).Select(i => i.Id).ToList();

        var byReport = await Cli("--feedback-images", "1", "99");
        var byPicture = await Cli("--feedback-images", ids[1].ToString());
        var none = await Cli("--feedback-images", "99");

        var entries = Untar(byReport.Out);
        entries.Keys.Should().BeEquivalentTo([$"1/{ids[0]}.png", $"1/{ids[1]}.png"]);
        entries[$"1/{ids[0]}.png"].Should().Equal(first);
        entries[$"1/{ids[1]}.png"].Should().Equal(second);
        byReport.Exit.Should().Be(0);
        byReport.Err.Should().Contain("Report 99 not found");
        Untar(byPicture.Out).Should().ContainSingle().Which.Key.Should().Be($"1/{ids[1]}.png");
        none.Exit.Should().Be(1);
    }

    [DockerFact]
    public async Task Resolve_sets_resolved_at_once_and_a_second_call_keeps_the_first_time_while_an_unknown_id_fails()
    {
        await Report("one", signedIn: false);

        var first = await Cli("--resolve-feedback", "1");
        var resolvedAt = (await Host.Db(db => db.Feedback.SingleAsync())).ResolvedAt;
        var again = await Cli("--resolve-feedback", "1");
        var unknown = await Cli("--resolve-feedback", "42");

        first.Exit.Should().Be(0);
        resolvedAt.Should().NotBeNull();
        again.Exit.Should().Be(0);
        System.Text.Encoding.UTF8.GetString(again.Out).Should().Contain("already resolved");
        (await Host.Db(db => db.Feedback.SingleAsync())).ResolvedAt.Should().Be(resolvedAt);
        unknown.Exit.Should().Be(1);
    }

    [DockerFact]
    public async Task A_failure_prints_only_the_exception_type_and_message_and_exits_1()
    {
        var (exit, _, err) = await CliWith("Host=127.0.0.1;Port=1;Database=none;Username=none;Password=none;Timeout=2", "--list-feedback");

        exit.Should().Be(1);
        err.Should().NotBeNullOrWhiteSpace().And.Contain("Exception: ").And.NotContain("   at ");
    }

    private static Dictionary<string, byte[]> Untar(byte[] tar)
    {
        var result = new Dictionary<string, byte[]>();
        using var reader = new TarReader(new MemoryStream(tar));
        while (reader.GetNextEntry() is { } entry)
        {
            var data = new MemoryStream();
            entry.DataStream!.CopyTo(data);
            result[entry.Name] = data.ToArray();
        }

        return result;
    }
}
