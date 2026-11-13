using Discord;
using Discord.Interactions;
using Ember.Core.Localization;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the select-menu interaction fired by /habit template.
/// Custom ID: habit:template:select
/// </summary>
public class TemplateSelectModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;
    private readonly IConfiguration _config;

    public TemplateSelectModule(HabitService habits, IConfiguration config)
    {
        _habits = habits;
        _config = config;
    }

    /// <summary>The template's name with its emoji (<c>☀️ Morning start</c>) in the user's language.</summary>
    internal static string Name(Texts t, HabitTemplates.Template template) => t.Get($"template.{template.Key}.name");

    /// <summary>The template's one-line description in the user's language.</summary>
    internal static string Description(Texts t, HabitTemplates.Template template) => t.Get($"template.{template.Key}.description");

    [ComponentInteraction("habit:template:select")]
    public async Task HandleTemplateSelectAsync(string[] selected)
    {
        var key      = selected[0];
        var template = HabitTemplates.Find(key);
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (template is null)
        {
            await RespondAsync(t.Get("template.unknown"), ephemeral: true);
            return;
        }

        // Strip leading emoji + space. Emoji are multi-char in UTF-16 so we can't
        // use char literals — find the first space and take everything after it.
        var rawName   = Name(t, template);
        var spaceIdx  = rawName.IndexOf(' ');
        var cleanName = spaceIdx >= 0 ? rawName[(spaceIdx + 1)..].Trim() : rawName;

        var frequency = template.Frequency == HabitTemplates.FrequencyHint.Weekly
            ? FrequencyType.Weekly
            : FrequencyType.Daily;

        Habit habit;
        try
        {
            habit = await _habits.AddHabitAsync(
                Context.User.Id,
                cleanName,
                reminderTime: null,
                frequency,
                template.WeeklyTarget);
        }
        catch (ConsentRequiredException)
        {
            await ConsentModule.RespondWithPromptAsync(Context, _config, _habits);
            return;
        }
        catch (HabitLimitReachedException)
        {
            await RespondAsync(t.Format("habit.limit", HabitService.MaxHabitsPerUser), ephemeral: true);
            return;
        }

        var hasTimezone = await _habits.HasTimezoneSetAsync(Context.User.Id);

        var freqLabel = frequency == FrequencyType.Weekly
            ? t.Format("template.per-week", template.WeeklyTarget)
            : t.Get("habit.freq.daily");
        var reminderLabel = template.SuggestedReminderTime.ToString(t.Get("time.suggested"), t.Culture);

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle(t.Format("template.started.title", rawName))
            .WithDescription(t.Format("template.started.body", habit.Name, freqLabel, Description(t, template), reminderLabel))
            .WithFooter(t.Get("template.started.footer"))
            .Build();

        ComponentBuilder components;

        if (!hasTimezone)
        {
            components = new ComponentBuilder()
                .WithButton(t.Get("common.timezone-first"), $"onboard:timezone:{habit.Id}", ButtonStyle.Primary, new Emoji("🌍"))
                .WithButton(t.Get("common.skip-for-now"), $"reminder:skip:{habit.Id}", ButtonStyle.Secondary);
        }
        else
        {
            components = new ComponentBuilder()
                .WithButton(t.Format("template.remind-at", reminderLabel), $"reminder:preset:{habit.Id}:{template.SuggestedReminderTime:HH\\:mm}", ButtonStyle.Primary, new Emoji("⏰"))
                .WithButton(t.Get("template.other-time"), $"reminder:set:{habit.Id}", ButtonStyle.Secondary)
                .WithButton(t.Get("template.no-reminder"), $"reminder:skip:{habit.Id}", ButtonStyle.Secondary);
        }

        components.WithButton(t.Get("common.days-and-times"), $"freq:menu:{habit.Id}", ButtonStyle.Secondary, new Emoji("📅"), row: 1);
        await RespondAsync(embed: embed, components: components.Build(), ephemeral: true);
    }
}
