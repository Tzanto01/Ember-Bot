using Discord;
using Discord.Interactions;
using Ember.Bot.Modules;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Ember.Bot.Services;

/// <summary>
/// After any successful interaction, asks a user who already has habits but hasn't agreed to the
/// health-data consent yet, with an ephemeral follow-up, at most once per local day until they agree.
/// </summary>
public class ConsentPromptNotifier
{
    private readonly IServiceProvider _services;
    private readonly ILogger<ConsentPromptNotifier> _logger;

    public ConsentPromptNotifier(IServiceProvider services, ILogger<ConsentPromptNotifier> logger)
    {
        _services = services;
        _logger   = logger;
    }

    public async Task OnInteractionExecutedAsync(ICommandInfo command, IInteractionContext context, IResult result)
    {
        if (!result.IsSuccess || context.Interaction is IAutocompleteInteraction || !context.Interaction.HasResponded)
            return;

        using var scope = _services.CreateScope();
        var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
        try
        {
            if (!await habits.ClaimConsentPromptAsync(context.User.Id))
                return;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not check health-data consent for user {UserId}.", context.User.Id);
            return;
        }

        try
        {
            await context.Interaction.FollowupAsync(
                embed: ConsentModule.PromptEmbed(scope.ServiceProvider.GetRequiredService<IConfiguration>()),
                components: ConsentModule.PromptButtons(context.User.Id),
                ephemeral: true);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not show the consent prompt to user {UserId}.", context.User.Id);
        }
    }
}
