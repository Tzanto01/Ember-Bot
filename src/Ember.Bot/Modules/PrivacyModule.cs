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

    [SlashCommand("optout", "Leave all leaderboards")]
    public async Task OptOutAsync()
    {
        await _habits.SetLeaderboardOptInAsync(Context.User.Id, false);
        await RespondAsync(LeaderboardModule.OptedOutText, ephemeral: true);
    }

    [SlashCommand("optin", "Join leaderboards (you're off them by default)")]
    public async Task OptInAsync()
    {
        await _habits.SetLeaderboardOptInAsync(Context.User.Id, true);
        await RespondAsync(LeaderboardModule.OptedInText, ephemeral: true);
    }
}
