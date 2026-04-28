using Discord;
using Discord.Interactions;
using Ember.Bot.Models;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the select-menu interaction fired by /habit template.
/// Custom ID: habit:template:select
/// </summary>
public class TemplateSelectModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public TemplateSelectModule(HabitService habits)
    {
        _habits = habits;
    }

    [ComponentInteraction("habit:template:select")]
    public async Task HandleTemplateSelectAsync(string[] selected)
    {
        var key      = selected[0];
        var template = HabitTemplates.Find(key);

        if (template is null)
        {
            await RespondAsync("Unknown template — try `/habit template` again.", ephemeral: true);
            return;
        }

        // Strip leading emoji + space. Emoji are multi-char in UTF-16 so we can't
        // use char literals — find the first space and take everything after it.
        var rawName   = template.DisplayName;
        var spaceIdx  = rawName.IndexOf(' ');
        var cleanName = spaceIdx >= 0 ? rawName[(spaceIdx + 1)..].Trim() : rawName;

        var frequency = template.Frequency == HabitTemplates.FrequencyHint.Weekly
            ? FrequencyType.Weekly
            : FrequencyType.Daily;

        var habit = await _habits.AddHabitAsync(
            Context.User.Id,
            cleanName,
            reminderTime: null,
            frequency,
            template.WeeklyTarget);

        var hasTimezone = await _habits.HasTimezoneSetAsync(Context.User.Id);

        var freqLabel = frequency == FrequencyType.Weekly
            ? $"{template.WeeklyTarget}× per week"
            : "daily";

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle($"🔥 {template.DisplayName} started!")
            .WithDescription(
                $"**{habit.Name}** is now being tracked ({freqLabel}).\n" +
                $"_{template.Description}_\n\n" +
                $"Suggested reminder: **{template.SuggestedReminderLabel}** — set it below if that works for you.")
            .WithFooter("You can rename it or change the frequency anytime with /habit edit or /habit frequency.")
            .Build();

        ComponentBuilder components;

        if (!hasTimezone)
        {
            components = new ComponentBuilder()
                .WithButton("Set my timezone first", $"onboard:timezone:{habit.Id}", ButtonStyle.Primary, new Emoji("🌍"))
                .WithButton("Skip for now", $"reminder:skip:{habit.Id}", ButtonStyle.Secondary);
        }
        else
        {
            components = new ComponentBuilder()
                .WithButton($"Remind me at {template.SuggestedReminderLabel}", $"reminder:preset:{habit.Id}:{template.SuggestedReminderTime:HH\\:mm}", ButtonStyle.Primary, new Emoji("⏰"))
                .WithButton("Set a different time", $"reminder:set:{habit.Id}", ButtonStyle.Secondary)
                .WithButton("No reminder", $"reminder:skip:{habit.Id}", ButtonStyle.Secondary);
        }

        await RespondAsync(embed: embed, components: components.Build(), ephemeral: true);
    }
}
