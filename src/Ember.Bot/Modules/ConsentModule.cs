using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Services;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

/// <summary>
/// Asks for explicit consent to store habit names and check-ins (GDPR Art. 9(2)(a)).
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

    internal static Embed PromptEmbed(IConfiguration config)
    {
        var description =
            "Habit names, check-ins and low days can say something about your health (think \"take my meds\" or \"sleep 8 hours\"). " +
            "Ember stores them only to run your habit tracker for you. They're never shared or sold.\n\n" +
            "Is that OK with you? You can withdraw any time with `/privacy delete`, which removes everything.";

        if (config[PolicyUrlKey] is { Length: > 0 } url)
            description += $"\n\n[Privacy policy]({url})";

        return new EmbedBuilder()
            .WithColor(0x5865F2)
            .WithTitle("One quick question 💙")
            .WithDescription(description)
            .Build();
    }

    internal static MessageComponent PromptButtons(ulong userId) => new ComponentBuilder()
        .WithButton("I agree", $"consent:agree:{userId}", ButtonStyle.Success)
        .WithButton("No thanks", $"consent:decline:{userId}", ButtonStyle.Secondary)
        .Build();

    /// <summary>Answers the interaction with the consent prompt and notes that it was shown today.</summary>
    internal static async Task RespondWithPromptAsync(IInteractionContext context, IConfiguration config, HabitService habits)
    {
        await context.Interaction.RespondAsync(embed: PromptEmbed(config), components: PromptButtons(context.User.Id), ephemeral: true);
        await habits.MarkConsentPromptedAsync(context.User.Id);
    }

    /// <summary>
    /// Applies the owner's answer only when the person clicking is that owner: agreeing records consent,
    /// declining stores nothing. Returns whether the clicker is the owner.
    /// </summary>
    internal static async Task<bool> TryAnswerAsync(HabitService habits, string ownerIdStr, ulong clickerId, bool agreed)
    {
        if (!ulong.TryParse(ownerIdStr, out var ownerId) || ownerId != clickerId) return false;
        if (agreed) await habits.GiveHealthDataConsentAsync(clickerId);
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
