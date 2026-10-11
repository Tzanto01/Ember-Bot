using Discord;
using Discord.Interactions;

namespace Ember.Bot.Modules;

public class HelpModule : InteractionModuleBase<SocketInteractionContext>
{
    [SlashCommand("help", "See everything Ember can do")]
    public async Task HelpAsync()
    {
        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle("Ember — Command Guide")
            .WithDescription("Low-pressure habit tracking. No guilt, no punishment — just progress.")
            .AddField("Getting started",
                "`/habit add` — create a new habit\n" +
                "`/habit template` — pick from pre-built habits\n" +
                "`/timezone set` — set your local timezone (needed for reminders)",
                inline: false)
            .AddField("Daily use",
                "`/habit checkin` — log today's check-in\n" +
                "`/habit list` — see all habits + recent progress\n" +
                "`/habit streak` — view your personal stats",
                inline: false)
            .AddField("Managing habits",
                "`/habit edit` — rename or change reminder time\n" +
                "`/habit delete` — remove a habit\n" +
                "`/habit pause` — pause temporarily (streak protected)\n" +
                "`/habit frequency` — switch between daily and weekly goals\n" +
                "`/habit grace` — set how many flex days you get per week",
                inline: false)
            .AddField("Share & compete",
                "`/habit share` — post a streak card in this channel\n" +
                "`/leaderboard` — top check-ins of opted-in members over the last 7 days",
                inline: false)
            .AddField("Privacy",
                "`/privacy optin` — join leaderboards (you're off them by default)\n" +
                "`/privacy optout` — leave leaderboards",
                inline: false)
            .WithFooter("Progress over perfection. Every check-in counts.")
            .Build();

        await RespondAsync(embed: embed, ephemeral: true);
    }
}
