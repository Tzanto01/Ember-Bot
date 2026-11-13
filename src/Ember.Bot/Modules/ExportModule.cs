using Discord;
using Discord.Interactions;
using Ember.Core.Localization;
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
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (user is null)
        {
            await FollowupAsync(t.Get("export.nothing"), ephemeral: true);
            return;
        }

        var (content, extension) = format == ExportFormat.Json
            ? (ExportBuilder.BuildJson(user, forDiscord: true), "json")
            : (ExportBuilder.BuildCsv(user, forDiscord: true), "csv");

        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(content));
        var filename = $"ember-export-{DateTime.UtcNow:yyyy-MM-dd}.{extension}";
        var attachment = new FileAttachment(stream, filename, t.Get("export.attachment"));
        var habitCount = user.Habits.Count;

        try
        {
            var dm = await Context.User.CreateDMChannelAsync();

            var embed = new EmbedBuilder()
                .WithColor(0xF4845F)
                .WithTitle(t.Get("export.dm.title"))
                .WithDescription(
                    t.Format("export.dm.intro", extension.ToUpperInvariant()) + "\n\n" +
                    t.Plural("export.dm.counts", habitCount, user.Habits.Sum(h => h.Logs.Count)) + "\n\n" +
                    FullExportLine(t, _config))
                .WithFooter(t.Get("export.dm.footer"))
                .WithTimestamp(DateTimeOffset.UtcNow)
                .Build();

            await dm.SendFileAsync(attachment, embed: embed);
            await FollowupAsync(t.Get("export.sent"), ephemeral: true);
        }
        catch
        {
            stream.Position = 0;
            await FollowupWithFileAsync(
                attachment,
                text: t.Format("export.no-dm", FullExportLine(t, _config)),
                ephemeral: true);
        }
    }

    /// <summary>Where the full export (with day notes, moods and account details) lives: the web app's settings.</summary>
    internal static string FullExportLine(Texts t, IConfiguration config)
        => config[LinkModule.WebOriginKey] is { Length: > 0 } origin
            ? t.Format("export.full.link", origin.TrimEnd('/'))
            : t.Get("export.full.app");
}
