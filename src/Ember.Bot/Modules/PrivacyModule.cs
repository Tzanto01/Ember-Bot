using Discord.Interactions;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

[Group("privacy", "Control your privacy settings")]
public class PrivacyModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public PrivacyModule(HabitService habits)
    {
        _habits = habits;
    }

    [SlashCommand("optout", "Remove yourself from all leaderboards")]
    public async Task OptOutAsync()
    {
        await _habits.SetLeaderboardOptOutAsync(Context.User.Id, true);
        await RespondAsync(
            "You're now opted out — your name won't appear on any leaderboard.\n" +
            "Your check-ins still count for your own stats.",
            ephemeral: true);
    }

    [SlashCommand("optin", "Re-join leaderboards")]
    public async Task OptInAsync()
    {
        await _habits.SetLeaderboardOptOutAsync(Context.User.Id, false);
        await RespondAsync(
            "Welcome back! You'll show up on leaderboards from your next check-in.",
            ephemeral: true);
    }
}
