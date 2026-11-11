using Discord;
using Discord.Interactions;
using Ember.Core.Services;
using Microsoft.Extensions.Configuration;
using System.Text;

namespace Ember.Bot.Modules;

public class ExportModule : InteractionModuleBase<SocketInteractionContext>
{
    public enum ExportFormat
    {
        [ChoiceDisplay("CSV (spreadsheet)")] Csv,
        [ChoiceDisplay("JSON")] Json,
    }

    private readonly HabitService _habits;
    private readonly IConfiguration _config;

    public ExportModule(HabitService habits, IConfiguration config)
    {
        _habits = habits;
        _config = config;
    }

    /// <summary>
    /// <c>/export [format]</c>: sends what the bot shows (settings, every habit including those without logs, every log with its
    /// guild id, day marks and routines) to the user's DMs, or as an ephemeral file if DMs fail. Day notes, moods, the journal key,
    /// the email, push subscriptions and logins never go to Discord (<see cref="ExportBuilder.BuildDocument"/> with <c>forDiscord</c>);
    /// the message points to the web app for the full export.
    /// CSV (default) is a single file: one row per record with a <c>record_type</c> column; see <see cref="ExportBuilder.BuildCsv"/>.
    /// </summary>
    [SlashCommand("export", "Export your habits, check-ins and settings to your DMs")]
    public async Task ExportAsync(
        [Summary("format", "File format (default CSV)")] ExportFormat format = ExportFormat.Csv)
    {
        await DeferAsync(ephemeral: true);

        var user = await _habits.GetUserForExportAsync(Context.User.Id);

        if (user is null)
        {
            await FollowupAsync("There's nothing stored about you yet, so there's nothing to export. 🌿", ephemeral: true);
            return;
        }

        var (content, extension) = format == ExportFormat.Json
            ? (ExportBuilder.BuildJson(user, forDiscord: true), "json")
            : (ExportBuilder.BuildCsv(user, forDiscord: true), "csv");

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
                    $"**{user.Habits.Sum(h => h.Logs.Count)}** total log entries\n\n" +
                    FullExportLine(_config))
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
                text: $"Couldn't send a DM (you may have DMs disabled). Here's the file directly:\n{FullExportLine(_config)}",
                ephemeral: true);
        }
    }

    /// <summary>Where the full export (with day notes, moods and account details) lives: the web app's settings.</summary>
    internal static string FullExportLine(IConfiguration config)
        => config[LinkModule.WebOriginKey] is { Length: > 0 } origin
            ? $"Your day notes, moods and account details stay out of Discord. The full export is in Settings: {origin.TrimEnd('/')}/settings"
            : "Your day notes, moods and account details stay out of Discord. The full export is in Settings in the Ember web app.";
}
