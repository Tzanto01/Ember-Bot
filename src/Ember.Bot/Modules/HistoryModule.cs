using System.Globalization;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Core.Services;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

/// <summary>
/// The /habit history grid: the last <see cref="Days"/> local days of one habit as buttons, plus a low-day menu.
/// Custom IDs: "history:day:{ownerId}:{habitId}:{yyyyMMdd}" (cycles not logged → done → not done → not logged)
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
        if (!int.TryParse(values[0], out var habitId)) { await BadIdAsync(); return; }
        await RenderAsync(habitId);
    }

    [ComponentInteraction("history:day:*:*:*")]
    public async Task OnDayAsync(string ownerIdStr, string habitIdStr, string dateStr)
    {
        if (!IsOwner(ownerIdStr)) { await NotYoursAsync(); return; }
        if (!int.TryParse(habitIdStr, out var habitId) || !TryParseDate(dateStr, out var date)) { await BadIdAsync(); return; }

        switch (await CycleDayAsync(_habits, Context.User.Id, habitId, date, Context.Guild?.Id))
        {
            case DayEditResult.HabitNotFound:
                await RespondAsync("Couldn't find that habit.", ephemeral: true);
                return;
            case DayEditResult.BeforeHabitStart:
                await RespondAsync("That day is before this habit started, so there's nothing to log.", ephemeral: true);
                return;
            case DayEditResult.InFuture:
                await RespondAsync("That day hasn't happened yet.", ephemeral: true);
                return;
        }

        await RenderAsync(habitId);
    }

    [ComponentInteraction("history:low:*:*")]
    public async Task OnLowDayAsync(string ownerIdStr, string habitIdStr, string[] values)
    {
        if (!IsOwner(ownerIdStr)) { await NotYoursAsync(); return; }
        if (!int.TryParse(habitIdStr, out var habitId) || !TryParseDate(values[0], out var date)) { await BadIdAsync(); return; }

        switch (await ToggleLowDayAsync(_habits, Context.User.Id, date))
        {
            case DayEditResult.ConsentRequired:
                await ConsentModule.RespondWithPromptAsync(Context, _config, _habits);
                return;
            case DayEditResult.InFuture:
                await RespondAsync("That day hasn't happened yet.", ephemeral: true);
                return;
        }

        await RenderAsync(habitId);
    }

    private async Task RenderAsync(int habitId)
    {
        var habit = await _habits.GetHabitAsync(Context.User.Id, habitId);
        var days = await _habits.GetHabitDaysAsync(Context.User.Id, habitId, Days);
        if (habit is null || days is null)
        {
            await RespondAsync("Couldn't find that habit.", ephemeral: true);
            return;
        }

        var lowDays = await _habits.GetLowDaysAsync(Context.User.Id);
        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content =
                $"**{habit.Name}**, last {Days} days. Tap a day to change it: ✅ done, ➖ not done, ▫️ not logged.\n" +
                "Today and yesterday stay open, and older days can be filled in any time.";
            m.Components = BuildGrid(Context.User.Id, habitId, days, lowDays);
        });
    }

    /// <summary>Moves the day's log one step along not logged → done → not done → not logged.</summary>
    internal static async Task<DayEditResult> CycleDayAsync(HabitService habits, ulong userId, int habitId, DateOnly date, ulong? guildId)
    {
        var today = await habits.GetLocalTodayAsync(userId);
        if (date > today) return DayEditResult.InFuture;

        var days = await habits.GetHabitDaysAsync(userId, habitId, today.DayNumber - date.DayNumber + 1);
        if (days is null) return DayEditResult.HabitNotFound;

        return days[0].Completed switch
        {
            null  => await habits.CheckInAsync(userId, habitId, date, completed: true, guildId),
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
    internal static MessageComponent BuildGrid(ulong userId, int habitId, IReadOnlyList<HabitDay> days, IReadOnlySet<DateOnly> lowDays)
    {
        var builder = new ComponentBuilder();
        for (var i = 0; i < days.Count; i++)
        {
            var day = days[i];
            builder.WithButton(
                DayLabel(day),
                $"history:day:{userId}:{habitId}:{day.Date.ToString(DateFormat, CultureInfo.InvariantCulture)}",
                day.State == DayState.Done ? ButtonStyle.Success : ButtonStyle.Secondary,
                disabled: day.State == DayState.BeforeStart,
                row: i / 5);
        }

        var menu = new SelectMenuBuilder()
            .WithCustomId($"history:low:{userId}:{habitId}")
            .WithPlaceholder("🌙 Mark or unmark a low day")
            .WithMinValues(1)
            .WithMaxValues(1);
        foreach (var day in days.Reverse())
            menu.AddOption(
                day.Date.ToString("ddd d MMM", CultureInfo.InvariantCulture),
                day.Date.ToString(DateFormat, CultureInfo.InvariantCulture),
                lowDays.Contains(day.Date) ? "🌙 low day, pick to remove" : null);

        return builder.WithSelectMenu(menu, row: (days.Count + 4) / 5).Build();
    }

    private static string DayLabel(HabitDay day)
    {
        var date = day.Date.ToString("ddd d", CultureInfo.InvariantCulture);
        var log = day.Completed switch { true => "✅", false => "➖", null => "▫️" };
        var symbol = day.State switch
        {
            DayState.BeforeStart => "",
            DayState.LowDay      => day.Completed is null ? "🌙" : "🌙" + log,
            DayState.Paused      => day.Completed is null ? "⏸️" : "⏸️" + log,
            _                    => log,
        };
        return symbol.Length == 0 ? date : $"{date} {symbol}";
    }

    private bool IsOwner(string ownerIdStr) => ulong.TryParse(ownerIdStr, out var ownerId) && ownerId == Context.User.Id;

    private static bool TryParseDate(string value, out DateOnly date) =>
        DateOnly.TryParseExact(value, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    private async Task NotYoursAsync() =>
        await RespondAsync("This button isn't for you.", ephemeral: true);

    private async Task BadIdAsync() =>
        await RespondAsync("Something went wrong, please try again.", ephemeral: true);
}
