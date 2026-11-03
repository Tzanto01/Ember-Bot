using Discord;
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
        if (!int.TryParse(habitIdStr, out var habitId) || !int.TryParse(targetStr, out var target))
        {
            await RespondAsync("Something went wrong — try `/habit frequency` again.", ephemeral: true);
            return;
        }

        var habit = await _habits.SetScheduleAsync(Context.User.Id, habitId, FrequencyType.Weekly, target, null, 1);

        if (habit is null)
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        await ((SocketMessageComponent)Context.Interaction)
            .UpdateAsync(m =>
            {
                m.Content    = $"**{habit.Name}** set to **{target}× per week** — check in any days you choose.";
                m.Components = new ComponentBuilder().Build();
            });
    }

    [ComponentInteraction("freq:menu:*")]
    public async Task ShowMenuAsync(string habitIdStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(); return; }
        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(); return; }

        await RespondAsync($"How often do you want to track **{habit.Name}**?",
            components: HabitSelectModule.FrequencyComponents(habitId), ephemeral: true);
    }

    [ComponentInteraction("freq:weekdays:*")]
    public async Task ShowWeekdaysAsync(string habitIdStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(); return; }
        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(); return; }

        var menu = new SelectMenuBuilder()
            .WithCustomId($"freq:days:{habitId}")
            .WithPlaceholder("Pick 1 to 6 days")
            .WithMinValues(1)
            .WithMaxValues(6);
        foreach (var name in ScheduleDayNames.All)
            menu.AddOption(char.ToUpperInvariant(name[0]) + name[1..], name);

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = $"Which days is **{habit.Name}** for? The other days are rest days.";
            m.Components = new ComponentBuilder().WithSelectMenu(menu).Build();
        });
    }

    [ComponentInteraction("freq:days:*")]
    public async Task SetWeekdaysAsync(string habitIdStr, string[] values)
    {
        if (!int.TryParse(habitIdStr, out var habitId) || values.Length is < 1 or > 6
            || !ScheduleDayNames.TryParse(values, out var days))
        {
            await BadIdAsync();
            return;
        }

        var current = await _habits.GetHabitAsync(Context.User.Id, habitId);
        var habit = current is null ? null
            : await _habits.SetScheduleAsync(Context.User.Id, habitId, FrequencyType.Weekdays, null, days, current.TimesPerDay);
        if (habit is null) { await NotFoundAsync(); return; }

        await DoneAsync($"**{habit.Name}** is now on **{HabitModule.FrequencyLabel(habit)}**. The other days are rest days. 💤");
    }

    [ComponentInteraction("freq:times:*")]
    public async Task ShowTimesAsync(string habitIdStr)
    {
        if (!int.TryParse(habitIdStr, out var habitId)) { await BadIdAsync(); return; }
        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (habit is null) { await NotFoundAsync(); return; }
        if (habit.FrequencyType == FrequencyType.Weekly) { await WeeklyOnlyOnceAsync(); return; }

        var menu = new SelectMenuBuilder()
            .WithCustomId($"freq:tpd:{habitId}")
            .WithPlaceholder("Times per day")
            .WithMinValues(1)
            .WithMaxValues(1);
        for (var n = 1; n <= HabitService.MaxTimesPerDay; n++)
            menu.AddOption(n == 1 ? "Once a day" : $"{n}× a day", n.ToString(), isDefault: n == habit.TimesPerDay);

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = $"How many times a day do you want to do **{habit.Name}**?";
            m.Components = new ComponentBuilder().WithSelectMenu(menu).Build();
        });
    }

    [ComponentInteraction("freq:tpd:*")]
    public async Task SetTimesAsync(string habitIdStr, string[] values)
    {
        if (!int.TryParse(habitIdStr, out var habitId) || !int.TryParse(values[0], out var times)
            || times is < 1 or > HabitService.MaxTimesPerDay)
        {
            await BadIdAsync();
            return;
        }

        var current = await _habits.GetHabitAsync(Context.User.Id, habitId);
        if (current is null) { await NotFoundAsync(); return; }
        if (current.FrequencyType == FrequencyType.Weekly) { await WeeklyOnlyOnceAsync(); return; }

        var habit = await _habits.SetScheduleAsync(Context.User.Id, habitId, current.FrequencyType, null, current.Days, times);
        if (habit is null) { await NotFoundAsync(); return; }

        await DoneAsync(times == 1
            ? $"**{habit.Name}** is back to once a day."
            : $"**{habit.Name}** is now **{times}× a day**. Each check-in counts towards it.");
    }

    private async Task DoneAsync(string text) =>
        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = text;
            m.Components = new ComponentBuilder().Build();
        });

    private async Task WeeklyOnlyOnceAsync() =>
        await RespondAsync("Times per day works for daily and weekday habits. Switch this one to daily or specific weekdays first.", ephemeral: true);

    private async Task BadIdAsync() =>
        await RespondAsync("Something went wrong — try `/habit frequency` again.", ephemeral: true);

    private async Task NotFoundAsync() =>
        await RespondAsync("Couldn't find that habit.", ephemeral: true);
}
