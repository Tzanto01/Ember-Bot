using Discord;
using Discord.Interactions;
using Ember.Core.Localization;
using Ember.Core.Models;
using Ember.Core.Services;

namespace Ember.Bot.Modules;

[Group("timezone", "Manage your timezone settings")]
public class TimezoneModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public TimezoneModule(HabitService habits)
    {
        _habits = habits;
    }

    // ── Autocomplete handler for timezone ────────────────────────────────────

    public class TimezoneAutocompleteHandler : AutocompleteHandler
    {
        public override Task<AutocompletionResult> GenerateSuggestionsAsync(
            IInteractionContext context,
            IAutocompleteInteraction autocompleteInteraction,
            IParameterInfo parameter,
            IServiceProvider services)
        {
            var typed = autocompleteInteraction.Data.Current.Value?.ToString() ?? "";

            var matches = TimeZoneInfo.GetSystemTimeZones()
                .Where(tz => tz.Id.Contains(typed, StringComparison.OrdinalIgnoreCase)
                          || tz.DisplayName.Contains(typed, StringComparison.OrdinalIgnoreCase))
                .Take(25)
                .Select(tz => new AutocompleteResult(tz.Id, tz.Id));

            return Task.FromResult(AutocompletionResult.FromSuccess(matches));
        }
    }

    [SlashCommand("set", "Set your local timezone")]
    public async Task SetAsync(
        [Summary("timezone", "Start typing your city or region"), Autocomplete(typeof(TimezoneAutocompleteHandler))] string tzId)
    {
        var tz = TimezoneHelper.Find(tzId);
        if (tz is null)
        {
            await RespondAsync((await BotTexts.ForAsync(_habits, Context.Interaction)).Format("timezone.not-found", tzId), ephemeral: true);
            return;
        }

        await _habits.SetTimezoneAsync(Context.User.Id, tz.Id, Languages.FromLocale(Context.Interaction.UserLocale));

        var rescheduled = await _habits.RescheduleRemindersAsync(Context.User.Id);
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        await RespondAsync(
            t.Format("timezone.set", tz.Id) +
            (rescheduled > 0
                ? "\n" + t.Format("timezone.rescheduled", rescheduled)
                : ""),
            ephemeral: true);
    }

    [SlashCommand("show", "Show your current timezone setting")]
    public async Task ShowAsync()
    {
        var tz = await _habits.GetUserTzAsync(Context.User.Id);

        await RespondAsync(
            (await BotTexts.ForAsync(_habits, Context.Interaction)).Format("timezone.show", tz.Id),
            ephemeral: true);
    }
}
