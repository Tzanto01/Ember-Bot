using Discord;
using Ember.Core.Localization;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Core.Models;
using Ember.Core.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the schedule components from <see cref="HabitSelectModule.FrequencyComponents"/>:
///   freq:menu:{habitId}          (button: shows the schedule buttons)
///   freq:weekly:{habitId}:{target}
///   freq:weekdays:{habitId}      (button: shows the freq:days select)
///   freq:days:{habitId}          (select, 1–6 of mon…sun)
///   freq:times:{habitId}         (button: shows the freq:tpd select)
///   freq:tpd:{habitId}           (select, 1–10)
/// </summary>
public class FrequencyButtonModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public FrequencyButtonModule(HabitService habits)
    {
        _habits = habits;
    }

    [ComponentInteraction("freq:weekly:*:*")]
    public async Task SetWeeklyTargetAsync(string habitIdStr, string targetStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId) || !int.TryParse(targetStr, out var target))
        {
            await BadIdAsync(t);
            return;
        }

        var habit = await _habits.SetScheduleAsync(Context.User.Id, habitId, FrequencyType.Weekly, target, null, 1);

        if (habit is null)
        {
            await NotFoundAsync(t);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = t.Format("freq.weekly-set", habit.Name, target);
                m.Components = new ComponentBuilder().Build();
            });
    }

    [ComponentInteraction("freq:menu:*")]
    public async Task ShowMenuAsync(string habitIdStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(t); return; }
        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(t); return; }

        await RespondAsync(t.Format("habit.frequency.question", habit.Name),
            components: HabitSelectModule.FrequencyComponents(t, habitId), ephemeral: true);
    }

    [ComponentInteraction("freq:weekdays:*")]
    public async Task ShowWeekdaysAsync(string habitIdStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(t); return; }
        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(t); return; }

        var menu = new SelectMenuBuilder()
            .WithCustomId($"freq:days:{habitId}")
            .WithPlaceholder(t.Get("freq.days.placeholder"))
            .WithMinValues(1)
            .WithMaxValues(6);
        foreach (var name in ScheduleDayNames.All)
            menu.AddOption(HabitModule.DayName(t, name), name);

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = t.Format("freq.days.question", habit.Name);
            m.Components = new ComponentBuilder().WithSelectMenu(menu).Build();
        });
    }

    [ComponentInteraction("freq:days:*")]
    public async Task SetWeekdaysAsync(string habitIdStr, string[] values)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId) || values.Length is < 1 or > 6
            || !ScheduleDayNames.TryParse(values, out var days))
        {
            await BadIdAsync(t);
            return;
        }

        var current = await _habits.GetHabitAsync(Context.User.Id, habitId);
        var habit = current is null ? null
            : await _habits.SetScheduleAsync(Context.User.Id, habitId, FrequencyType.Weekdays, null, days, current.TimesPerDay);
        if (habit is null) { await NotFoundAsync(t); return; }

        await DoneAsync(t.Format("freq.days.set", habit.Name, HabitModule.FrequencyLabel(t, habit)));
    }

    [ComponentInteraction("freq:times:*")]
    public async Task ShowTimesAsync(string habitIdStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(t); return; }
        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(t); return; }
        if (habit.FrequencyType == FrequencyType.Weekly) { await WeeklyOnlyOnceAsync(t); return; }

        var menu = new SelectMenuBuilder()
            .WithCustomId($"freq:tpd:{habitId}")
            .WithPlaceholder(t.Get("freq.times.placeholder"))
            .WithMinValues(1)
            .WithMaxValues(1);
        for (var n = 1; n <= HabitService.MaxTimesPerDay; n++)
            menu.AddOption(n == 1 ? t.Get("freq.times.once") : t.Format("freq.times.option", n), n.ToString(), isDefault: n == habit.TimesPerDay);

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = t.Format("freq.times.question", habit.Name);
            m.Components = new ComponentBuilder().WithSelectMenu(menu).Build();
        });
    }

    [ComponentInteraction("freq:tpd:*")]
    public async Task SetTimesAsync(string habitIdStr, string[] values)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(habitIdStr, out var habitId) || !int.TryParse(values[0], out var times)
            || times is < 1 or > HabitService.MaxTimesPerDay)
        {
            await BadIdAsync(t);
            return;
        }

        var current = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (current is null) { await NotFoundAsync(t); return; }
        if (current.FrequencyType == FrequencyType.Weekly) { await WeeklyOnlyOnceAsync(t); return; }

        var habit = await _habits.SetScheduleAsync(Context.User.Id, habitId, current.FrequencyType, null, current.Days, times);
        if (habit is null) { await NotFoundAsync(t); return; }

        await DoneAsync(times == 1
            ? t.Format("freq.times.once-set", habit.Name)
            : t.Format("freq.times.set", habit.Name, times));
    }

    private async Task DoneAsync(string text) =>
        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = text;
            m.Components = new ComponentBuilder().Build();
        });

    private async Task WeeklyOnlyOnceAsync(Texts t) =>
        await RespondAsync(t.Get("freq.times.weekly"), ephemeral: true);

    private async Task BadIdAsync(Texts t) =>
        await RespondAsync(t.Get("freq.retry"), ephemeral: true);

    private async Task NotFoundAsync(Texts t) =>
        await RespondAsync(t.Get("common.not-found"), ephemeral: true);
}
