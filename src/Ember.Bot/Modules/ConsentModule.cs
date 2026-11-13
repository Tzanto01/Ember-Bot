using Ember.Core.Localization;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Core.Services;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

/// <summary>
/// Asks for explicit consent to store habit names, check-ins, low days, day notes and moods (GDPR Art. 9(2)(a)).
/// Custom IDs: "consent:agree:{discordUserId}", "consent:decline:{discordUserId}".
/// </summary>
public class ConsentModule : InteractionModuleBase<SocketInteractionContext>
{
    internal const string PolicyUrlKey = "Ember:PrivacyPolicyUrl";

    internal const string AgreedText =
        "Thank you, you're all set. 💙 If you were adding a habit, just run the command again.";

    internal const string DeclinedText =
        "No problem. 💙 Ember can only store habits with your OK, so I won't create any new ones. " +
        "Anything you already have here stays as it is until you decide. You can say yes any time by adding a habit, " +
        "or remove everything Ember stores about you below.";

    private readonly HabitService _habits;

    public ConsentModule(HabitService habits)
    {
        _habits = habits;
    }

    internal static Embed PromptEmbed(Texts t, IConfiguration config)
    {
        var description = t.Get("consent.body");

        if (config[PolicyUrlKey] is { Length: > 0 } url)
            description += "\n\n" + t.Format("consent.policy-link", url);

        return new EmbedBuilder()
            .WithColor(0x5865F2)
            .WithTitle(t.Get("consent.title"))
            .WithDescription(description)
            .Build();
    }

    internal static MessageComponent PromptButtons(Texts t, ulong userId) => new ComponentBuilder()
        .WithButton(t.Get("consent.agree"), $"consent:agree:{userId}", ButtonStyle.Success)
        .WithButton(t.Get("consent.decline"), $"consent:decline:{userId}", ButtonStyle.Secondary)
        .Build();

    /// <summary>Answers the interaction with the consent prompt and notes that it was shown today.</summary>
    internal static async Task RespondWithPromptAsync(IInteractionContext context, IConfiguration config, HabitService habits)
    {
        await context.Interaction.RespondAsync(embed: PromptEmbed(BotTexts.English, config), components: PromptButtons(BotTexts.English, context.User.Id), ephemeral: true);
        await habits.MarkConsentPromptedAsync(context.User.Id);
    }

    /// <summary>
    /// Applies the owner's answer only when the person clicking is that owner: agreeing records consent, declining only
    /// holds back the next automatic prompt (<see cref="HabitService.ConsentDeclineBackoffDays"/>). Returns whether the clicker is the owner.
    /// </summary>
    internal static async Task<bool> TryAnswerAsync(HabitService habits, string ownerIdStr, ulong clickerId, bool agreed)
    {
        if (!ulong.TryParse(ownerIdStr, out var ownerId) || ownerId != clickerId) return false;
        if (agreed) await habits.GiveHealthDataConsentAsync(clickerId);
        else await habits.DeclineConsentPromptAsync(clickerId);
        return true;
    }

    [ComponentInteraction("consent:agree:*")]
    public async Task OnAgreeAsync(string ownerIdStr)
    {
        if (!await TryAnswerAsync(_habits, ownerIdStr, Context.User.Id, agreed: true))
        {
            await RespondAsync("This button isn't for you.", ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = AgreedText;
            m.Embed      = null;
            m.Components = new ComponentBuilder().Build();
        });
    }

    [ComponentInteraction("consent:decline:*")]
    public async Task OnDeclineAsync(string ownerIdStr)
    {
        if (!await TryAnswerAsync(_habits, ownerIdStr, Context.User.Id, agreed: false))
        {
            await RespondAsync("This button isn't for you.", ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = DeclinedText;
            m.Embed      = null;
            m.Components = new ComponentBuilder()
                .WithButton("Delete my data", $"privacy:delete:start:{Context.User.Id}", ButtonStyle.Secondary)
                .Build();
        });
    }
}
