using System.Globalization;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Core.Localization;
using Ember.Core.Services;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

/// <summary>
/// The /habit history grid: the last <see cref="Days"/> local days of one habit as buttons, plus a low-day menu.
/// Custom IDs: "history:day:{ownerId}:{habitId}:{yyyyMMdd}" (cycles not logged → one more check-in until done → not done → not logged)
/// and the select "history:low:{ownerId}:{habitId}" with yyyyMMdd values (toggles a low day).
/// </summary>
public class HistoryModule : InteractionModuleBase<SocketInteractionContext>
{
    internal const int Days = 14;
    private const string DateFormat = "yyyyMMdd";

    private readonly HabitService _habits;
    private readonly IConfiguration _config;

    public HistoryModule(HabitService habits, IConfiguration config)
    {
        _habits = habits;
        _config = config;
    }

    [ComponentInteraction("habit:select:history")]
    public async Task OnSelectHistoryAsync(string[] values)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(t); return; }
        await RenderAsync(t, habitId);
    }

    [ComponentInteraction("history:day:*:*:*")]
    public async Task OnDayAsync(string ownerIdStr, string habitIdStr, string dateStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!IsOwner(ownerIdStr)) { await NotYoursAsync(t); return; }
        if (!int.TryParse(habitIdStr, out var habitId) || !TryParseDate(dateStr, out var date)) { await BadIdAsync(t); return; }

        switch (await CycleDayAsync(_habits, Context.User.Id, habitId, date, Context.Guild?.Id))
        {
            case DayEditResult.HabitNotFound:
                await RespondAsync(t.Get("common.not-found"), ephemeral: true);
                return;
            case DayEditResult.BeforeHabitStart:
                await RespondAsync(t.Get("history.before-start"), ephemeral: true);
                return;
            case DayEditResult.InFuture:
                await RespondAsync(t.Get("history.in-future"), ephemeral: true);
                return;
        }

        await RenderAsync(t, habitId);
    }

    [ComponentInteraction("history:low:*:*")]
    public async Task OnLowDayAsync(string ownerIdStr, string habitIdStr, string[] values)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!IsOwner(ownerIdStr)) { await NotYoursAsync(t); return; }
        if (!int.TryParse(habitIdStr, out var habitId) || !TryParseDate(values[0], out var date)) { await BadIdAsync(t); return; }

        switch (await ToggleLowDayAsync(_habits, Context.User.Id, date))
        {
            case DayEditResult.ConsentRequired:
                await ConsentModule.RespondWithPromptAsync(Context, _config, _habits);
                return;
            case DayEditResult.InFuture:
                await RespondAsync(t.Get("history.in-future"), ephemeral: true);
                return;
        }

        await RenderAsync(t, habitId);
    }

    private async Task RenderAsync(Texts t, int habitId)
    {
        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        var days = await _habits.GetHabitDaysAsync(Context.User.Id, habitId, Days);
        if (habit is null || days is null)
        {
            await RespondAsync(t.Get("common.not-found"), ephemeral: true);
            return;
        }

        var lowDays = await _habits.GetLowDaysAsync(Context.User.Id);
        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content = t.Format("history.grid", habit.Name, Days);
            m.Components = BuildGrid(t, Context.User.Id, habitId, days, lowDays);
        });
    }

    /// <summary>Moves the day's log one step along not logged → one more check-in (until done) → not done → not logged.</summary>
    internal static async Task<DayEditResult> CycleDayAsync(HabitService habits, ulong userId, int habitId, DateOnly date, ulong? guildId)
    {
        var today = await habits.GetLocalTodayAsync(userId);
        if (date > today) return DayEditResult.InFuture;

        var days = await habits.GetHabitDaysAsync(userId, habitId, today.DayNumber - date.DayNumber + 1);
        if (days is null) return DayEditResult.HabitNotFound;

        return days[0].Completed switch
        {
            null  => await habits.AddCheckInAsync(userId, habitId, date, guildId),
            true  => await habits.CheckInAsync(userId, habitId, date, completed: false, guildId),
            false => await habits.ClearDayAsync(userId, habitId, date),
        };
    }

    /// <summary>Sets a low day on <paramref name="date"/>, or removes it when it is already one.</summary>
    internal static async Task<DayEditResult> ToggleLowDayAsync(HabitService habits, ulong userId, DateOnly date)
    {
        if (!(await habits.GetLowDaysAsync(userId)).Contains(date))
            return await habits.SetLowDayAsync(userId, date);

        await habits.ClearLowDayAsync(userId, date);
        return DayEditResult.Saved;
    }

    /// <summary>Builds the day buttons (5 per row) and the low-day menu for <paramref name="days"/>, oldest first.</summary>
    internal static MessageComponent BuildGrid(Texts t, ulong userId, int habitId, IReadOnlyList<HabitDay> days, IReadOnlySet<DateOnly> lowDays)
    {
        var builder = new ComponentBuilder();
        for (var i = 0; i < days.Count; i++)
        {
            var day = days[i];
            builder.WithButton(
                DayLabel(t, day),
                $"history:day:{userId}:{habitId}:{day.Date.ToString(DateFormat, CultureInfo.InvariantCulture)}",
                day.State == DayState.Done ? ButtonStyle.Success : ButtonStyle.Secondary,
                disabled: day.State == DayState.BeforeStart,
                row: i / 5);
        }

        var menu = new SelectMenuBuilder()
            .WithCustomId($"history:low:{userId}:{habitId}")
            .WithPlaceholder(t.Get("history.low.placeholder"))
            .WithMinValues(1)
            .WithMaxValues(1);
        foreach (var day in days.Reverse())
            menu.AddOption(
                day.Date.ToString(t.Get("date.short"), t.Culture),
                day.Date.ToString(DateFormat, CultureInfo.InvariantCulture),
                lowDays.Contains(day.Date) ? t.Get("history.low.marked") : null);

        return builder.WithSelectMenu(menu, row: (days.Count + 4) / 5).Build();
    }

    private static string DayLabel(Texts t, HabitDay day)
    {
        var date = day.Date.ToString(t.Get("date.button"), t.Culture);
        var unlogged = day.Completed is null && day.Count == 0;
        var log = day.Completed switch { true => "✅", false => "➖", null => unlogged ? "▫️" : $"🔸{day.Count}" };
        var symbol = day.State switch
        {
            DayState.BeforeStart => "",
            DayState.LowDay      => unlogged ? "🌙" : "🌙" + log,
            DayState.Paused      => unlogged ? "⏸️" : "⏸️" + log,
            DayState.Offday      => "💤",
            _                    => log,
        };
        return symbol.Length == 0 ? date : $"{date} {symbol}";
    }

    private bool IsOwner(string ownerIdStr) => ulong.TryParse(ownerIdStr, out var ownerId) && ownerId == Context.User.Id;

    private static bool TryParseDate(string value, out DateOnly date) =>
        DateOnly.TryParseExact(value, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    private async Task NotYoursAsync(Texts t) =>
        await RespondAsync(t.Get("common.not-yours"), ephemeral: true);

    private async Task BadIdAsync(Texts t) =>
        await RespondAsync(t.Get("common.retry.comma"), ephemeral: true);
}
