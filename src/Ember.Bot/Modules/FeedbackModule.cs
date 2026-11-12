using Discord;
using Discord.Interactions;
using Ember.Bot.Services;
using Ember.Core.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// <c>/feedback</c>: a modal whose text is stored as feedback from <c>discord</c>, linked to the user's Ember account when
/// they have one (never creating one). Limited by <see cref="FeedbackCooldown"/>, checked on open and counted on submit.
/// </summary>
public class FeedbackModule : InteractionModuleBase<SocketInteractionContext>
{
    internal const string ModalId = "feedback:modal";

    internal const string ThanksText = "Thank you, that really helps. 💙 Your feedback is on its way to the Ember team.";

    internal const string CooldownText = "You've sent a lot of feedback this hour. 💙 Try again a little later.";

    internal const string DailyLimitText = "Ember has had a lot of feedback today. 💙 Try again tomorrow.";

    internal const string InvalidText = "That feedback came through empty or with characters Ember can't keep. 💙 Try again with plain text.";

    private readonly HabitService _habits;
    private readonly FeedbackCooldown _cooldown;

    public FeedbackModule(HabitService habits, FeedbackCooldown cooldown)
    {
        _habits = habits;
        _cooldown = cooldown;
    }

    [SlashCommand("feedback", "Tell the Ember team what would make Ember better")]
    public async Task FeedbackAsync()
    {
        if (!_cooldown.CanSend(Context.User.Id))
        {
            await RespondAsync(CooldownText, ephemeral: true);
            return;
        }

        await RespondWithModalAsync<FeedbackModal>(ModalId);
    }

    [ModalInteraction(ModalId)]
    public async Task OnModalAsync(FeedbackModal modal)
    {
        var text = modal.Text.Trim();
        if (HabitService.FeedbackTextError(text) is not null)
        {
            await RespondAsync(InvalidText, ephemeral: true);
            return;
        }

        if (!_cooldown.TryRecord(Context.User.Id))
        {
            await RespondAsync(CooldownText, ephemeral: true);
            return;
        }

        var userId = await _habits.FindDiscordUserAsync(Context.User.Id);
        var saved = await _habits.SaveFeedbackAsync(userId == Guid.Empty ? null : userId, "discord", null, text);
        await RespondAsync(saved ? ThanksText : DailyLimitText, ephemeral: true);
    }
}

public class FeedbackModal : IModal
{
    public string Title => "Send feedback";

    [InputLabel("What would make Ember better?")]
    [ModalTextInput("feedback_text", TextInputStyle.Paragraph, minLength: 1, maxLength: HabitService.MaxFeedbackLength)]
    public string Text { get; set; } = "";
}
