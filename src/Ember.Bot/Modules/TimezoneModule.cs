using Discord;
using Discord.Interactions;
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
            await RespondAsync(
                $"Couldn't find timezone `{tzId}`.\n" +
                "Use an IANA timezone name, e.g. `Europe/Amsterdam`, `America/New_York`, `Asia/Tokyo`.\n" +
                "Full list: <https://en.wikipedia.org/wiki/List_of_tz_database_time_zones>",
                ephemeral: true);
            return;
        }

        await _habits.SetTimezoneAsync(Context.User.Id, tz.Id);

        var rescheduled = await _habits.RescheduleRemindersAsync(Context.User.Id);

        await RespondAsync(
            $"Timezone set to **{tz.Id}**." +
            (rescheduled > 0
                ? $"\nRescheduled {rescheduled} reminder(s) to match."
                : ""),
            ephemeral: true);
    }

    [SlashCommand("show", "Show your current timezone setting")]
    public async Task ShowAsync()
    {
        var tz = await _habits.GetUserTzAsync(Context.User.Id);

        await RespondAsync(
            $"Your timezone is currently **{tz.Id}**.",
            ephemeral: true);
    }
}
