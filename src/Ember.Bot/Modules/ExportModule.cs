using Discord;
using Discord.Interactions;
using Ember.Bot.Services;
using System.Text;

namespace Ember.Bot.Modules;

[Group("export", "Export your data")]
public class ExportModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public ExportModule(HabitService habits)
    {
        _habits = habits;
    }

    [SlashCommand("habits", "Export all your habit logs as a CSV sent to your DMs")]
    public async Task ExportAsync()
    {
        await DeferAsync(ephemeral: true);

        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        if (habits.Count == 0)
        {
            await FollowupAsync("You don't have any habits to export yet.", ephemeral: true);
            return;
        }

        // Build CSV in memory — no temp files
        var csv = new StringBuilder();
        csv.AppendLine("habit_id,habit_name,frequency,weekly_target,date,completed");

        foreach (var habit in habits)
        {
            var freq   = habit.FrequencyType.ToString().ToLower();
            var target = habit.WeeklyTarget?.ToString() ?? "";

            foreach (var log in habit.Logs.OrderBy(l => l.Date))
            {
                csv.AppendLine(
                    $"{habit.Id}," +
                    $"\"{habit.Name.Replace("\"", "\"\"")}\"," +
                    $"{freq}," +
                    $"{target}," +
                    $"{log.Date:yyyy-MM-dd}," +
                    $"{(log.Completed ? "true" : "false")}");
            }
        }

        var bytes = Encoding.UTF8.GetBytes(csv.ToString());
        using var stream = new MemoryStream(bytes);

        var filename = $"ember-export-{DateTime.UtcNow:yyyy-MM-dd}.csv";
        var attachment = new FileAttachment(stream, filename, "Your Ember habit data");

        try
        {
            var dm = await Context.User.CreateDMChannelAsync();

            var embed = new EmbedBuilder()
                .WithColor(0xF4845F)
                .WithTitle("📊 Your Ember data")
                .WithDescription(
                    $"All your habit logs exported as CSV.\n\n" +
                    $"**{habits.Count}** habit{(habits.Count != 1 ? "s" : "")} · " +
                    $"**{habits.Sum(h => h.Logs.Count)}** total log entries")
                .WithFooter("This is your data — keep it, analyse it, do whatever you want with it.")
                .WithTimestamp(DateTimeOffset.UtcNow)
                .Build();

            await dm.SendFileAsync(attachment, embed: embed);
            await FollowupAsync("Done — check your DMs! 💙", ephemeral: true);
        }
        catch
        {
            // DMs disabled — send ephemerally instead using the file overload
            stream.Position = 0;
            await FollowupWithFileAsync(
                attachment,
                text: "Couldn't send a DM (you may have DMs disabled). Here's the file directly:",
                ephemeral: true);
        }
    }
}
