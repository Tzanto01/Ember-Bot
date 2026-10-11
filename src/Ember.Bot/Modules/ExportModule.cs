using Discord;
using Discord.Interactions;
using Ember.Bot.Data;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;
using System.Text;

namespace Ember.Bot.Modules;

public class ExportModule : InteractionModuleBase<SocketInteractionContext>
{
    public enum ExportFormat
    {
        [ChoiceDisplay("CSV (spreadsheet)")] Csv,
        [ChoiceDisplay("JSON")] Json,
    }

    private readonly EmberDbContext _db;

    public ExportModule(EmberDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// <c>/export [format]</c>: sends the user's complete data (settings, every habit including those
    /// without logs, every log with its guild id) to their DMs, or as an ephemeral file if DMs fail.
    /// CSV (default) is a single file: one row per record with a <c>record_type</c> column
    /// (<c>settings</c>, <c>habit</c>, <c>log</c>); see <see cref="ExportBuilder.BuildCsv"/>.
    /// JSON is one document with <c>settings</c>, <c>habits</c> and <c>logs</c>.
    /// </summary>
    [SlashCommand("export", "Export all your Ember data (settings, habits, logs) to your DMs")]
    public async Task ExportAsync(
        [Summary("format", "File format (default CSV)")] ExportFormat format = ExportFormat.Csv)
    {
        await DeferAsync(ephemeral: true);

        var userId = (long)Context.User.Id;
        var user = await _db.Users
            .AsNoTracking()
            .Include(u => u.Habits).ThenInclude(h => h.Logs)
            .AsSplitQuery()
            .FirstOrDefaultAsync(u => u.DiscordUserId == userId);

        if (user is null)
        {
            await FollowupAsync("There's nothing stored about you yet, so there's nothing to export. 🌿", ephemeral: true);
            return;
        }

        var (content, extension) = format == ExportFormat.Json
            ? (ExportBuilder.BuildJson(user), "json")
            : (ExportBuilder.BuildCsv(user), "csv");

        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(content));
        var filename = $"ember-export-{DateTime.UtcNow:yyyy-MM-dd}.{extension}";
        var attachment = new FileAttachment(stream, filename, "Your Ember data");
        var habitCount = user.Habits.Count;

        try
        {
            var dm = await Context.User.CreateDMChannelAsync();

            var embed = new EmbedBuilder()
                .WithColor(0xF4845F)
                .WithTitle("📊 Your Ember data")
                .WithDescription(
                    $"Your settings, habits and logs exported as {extension.ToUpperInvariant()}.\n\n" +
                    $"**{habitCount}** habit{(habitCount != 1 ? "s" : "")} · " +
                    $"**{user.Habits.Sum(h => h.Logs.Count)}** total log entries")
                .WithFooter("This is your data — keep it, analyse it, do whatever you want with it.")
                .WithTimestamp(DateTimeOffset.UtcNow)
                .Build();

            await dm.SendFileAsync(attachment, embed: embed);
            await FollowupAsync("Done — check your DMs! 💙", ephemeral: true);
        }
        catch
        {
            stream.Position = 0;
            await FollowupWithFileAsync(
                attachment,
                text: "Couldn't send a DM (you may have DMs disabled). Here's the file directly:",
                ephemeral: true);
        }
    }
}
