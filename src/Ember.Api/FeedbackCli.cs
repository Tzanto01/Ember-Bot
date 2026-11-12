using System.Formats.Tar;
using System.Globalization;
using Ember.Core.Data;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api;

/// <summary>
/// Operator commands on the stored feedback, run inside the API container (<c>docker compose exec -T api dotnet Ember.Api.dll
/// ...</c>) against <c>ConnectionStrings:DefaultConnection</c> from the environment, without starting the web host. Never
/// reachable over HTTP.
/// <list type="bullet">
/// <item><c>--list-feedback [--all]</c>: read-only; prints the unresolved reports (with <c>--all</c> every report), oldest first:
/// id, created and resolved time (UTC), platform, version, <c>user {id}</c> or <c>anonymous</c>, the title and text quoted with
/// <c>&gt; </c> and the picture ids. Exit 0.</item>
/// <item><c>--feedback-images &lt;id&gt;...</c>: each id a report id (integer, all its pictures) or a picture id (GUID); writes a
/// tar stream to stdout with entries <c>{reportId}/{pictureId}.{jpg|png|webp}</c>, the stored (already stripped) bytes. Unknown
/// ids and reports without pictures go to stderr; exit 1 when nothing was found.</item>
/// <item><c>--resolve-feedback &lt;reportId&gt;...</c>: marks each open report resolved now, which starts the
/// <see cref="FeedbackDigest.ImageRetentionDays"/> until its pictures are deleted; prints what changed, unknown ids to stderr;
/// exit 1 when any id was invalid or unknown.</item>
/// </list>
/// </summary>
internal static class FeedbackCli
{
    /// <summary>Whether <paramref name="args"/> start with one of the verbs.</summary>
    public static bool Handles(string[] args) => args is ["--list-feedback", ..] or ["--feedback-images", ..] or ["--resolve-feedback", ..];

    /// <summary>Runs the verb in <paramref name="args"/> and returns the exit code.</summary>
    public static async Task<int> RunAsync(string[] args)
    {
        var configuration = new ConfigurationBuilder().AddEnvironmentVariables().Build();
        var options = new DbContextOptionsBuilder<EmberDbContext>().UseNpgsql(configuration.GetConnectionString("DefaultConnection")).Options;
        await using var db = new EmberDbContext(options);
        return args switch
        {
            ["--list-feedback"] => await ListAsync(db, all: false),
            ["--list-feedback", "--all"] => await ListAsync(db, all: true),
            ["--feedback-images", _, ..] => await ImagesAsync(db, args[1..]),
            ["--resolve-feedback", _, ..] => await ResolveAsync(db, args[1..]),
            _ => Usage(),
        };
    }

    private static int Usage()
    {
        Console.Error.WriteLine("Usage: --list-feedback [--all] | --feedback-images <reportId|pictureId>... | --resolve-feedback <reportId>...");
        return 1;
    }

    private static async Task<int> ListAsync(EmberDbContext db, bool all)
    {
        var items = await db.Feedback.AsNoTracking()
            .Where(f => all || f.ResolvedAt == null)
            .OrderBy(f => f.CreatedAt).ThenBy(f => f.Id)
            .Select(f => new { f.Id, f.CreatedAt, f.ResolvedAt, f.Platform, f.Version, f.UserId, f.Title, f.Text, Pictures = f.Images.OrderBy(i => i.Id).Select(i => i.Id).ToList() })
            .ToListAsync();
        var output = Console.Out;
        foreach (var item in items)
        {
            await output.WriteLineAsync(string.Create(CultureInfo.InvariantCulture,
                $"#{item.Id} · {Utc(item.CreatedAt)}{(item.ResolvedAt is { } resolved ? " · resolved " + Utc(resolved) : "")} · {item.Platform} {item.Version ?? "unknown version"} · {(item.UserId is { } userId ? $"user {userId}" : "anonymous")}"));
            await output.WriteLineAsync("> " + item.Title);
            await output.WriteLineAsync(">");
            foreach (var line in item.Text.ReplaceLineEndings("\n").Split('\n')) await output.WriteLineAsync("> " + line);
            if (item.Pictures.Count > 0) await output.WriteLineAsync("Pictures: " + string.Join(", ", item.Pictures));
            await output.WriteLineAsync();
        }

        return 0;
    }

    private static async Task<int> ImagesAsync(EmberDbContext db, string[] ids)
    {
        var reportIds = new List<int>();
        var pictureIds = new List<Guid>();
        foreach (var id in ids)
        {
            if (int.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out var reportId)) reportIds.Add(reportId);
            else if (Guid.TryParse(id, out var pictureId)) pictureIds.Add(pictureId);
            else await Console.Error.WriteLineAsync($"Not a report or picture id: {id}");
        }

        var found = await db.FeedbackImages.AsNoTracking()
            .Where(i => reportIds.Contains(i.FeedbackId) || pictureIds.Contains(i.Id))
            .OrderBy(i => i.FeedbackId).ThenBy(i => i.Id)
            .Select(i => new { i.Id, i.FeedbackId, i.ContentType })
            .ToListAsync();
        var existingReports = await db.Feedback.Where(f => reportIds.Contains(f.Id)).Select(f => f.Id).ToListAsync();
        foreach (var reportId in reportIds.Distinct())
        {
            if (!existingReports.Contains(reportId)) await Console.Error.WriteLineAsync($"Report {reportId} not found.");
            else if (!found.Any(i => i.FeedbackId == reportId)) await Console.Error.WriteLineAsync($"Report {reportId} has no pictures.");
        }
        foreach (var pictureId in pictureIds.Distinct().Where(p => !found.Any(i => i.Id == p)))
            await Console.Error.WriteLineAsync($"Picture {pictureId} not found.");
        if (found.Count == 0) return 1;

        await using var tar = new TarWriter(Console.OpenStandardOutput(), TarEntryFormat.Pax, leaveOpen: false);
        foreach (var image in found.DistinctBy(i => i.Id))
        {
            var data = await db.FeedbackImages.Where(i => i.Id == image.Id).Select(i => i.Data).FirstOrDefaultAsync();
            if (data is null) continue;

            var extension = image.ContentType switch { "image/png" => "png", "image/webp" => "webp", _ => "jpg" };
            await tar.WriteEntryAsync(new PaxTarEntry(TarEntryType.RegularFile, $"{image.FeedbackId}/{image.Id}.{extension}")
            {
                DataStream = new MemoryStream(data, writable: false),
            });
        }

        return 0;
    }

    private static async Task<int> ResolveAsync(EmberDbContext db, string[] ids)
    {
        var exitCode = 0;
        foreach (var id in ids)
        {
            if (!int.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out var reportId))
            {
                await Console.Error.WriteLineAsync($"Not a report id: {id}");
                exitCode = 1;
                continue;
            }

            var now = DateTime.UtcNow;
            if (await db.Feedback.Where(f => f.Id == reportId && f.ResolvedAt == null).ExecuteUpdateAsync(s => s.SetProperty(f => f.ResolvedAt, now)) > 0)
                await Console.Out.WriteLineAsync($"Report {reportId} resolved at {Utc(now)}.");
            else if (await db.Feedback.Where(f => f.Id == reportId).Select(f => f.ResolvedAt).FirstOrDefaultAsync() is { } resolved)
                await Console.Out.WriteLineAsync($"Report {reportId} was already resolved at {Utc(resolved)}.");
            else
            {
                await Console.Error.WriteLineAsync($"Report {reportId} not found.");
                exitCode = 1;
            }
        }

        return exitCode;
    }

    private static string Utc(DateTime time) => time.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
}
