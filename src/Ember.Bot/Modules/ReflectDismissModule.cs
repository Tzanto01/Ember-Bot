using System.Globalization;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Jobs;
using Ember.Bot.Models;
using Ember.Bot.Services;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the buttons on MissedDayReflectionJob DMs.
/// Custom IDs: reflect:dismiss:{userId}, reflect:log:{userId}:{yyyyMMdd}, reflect:low:{userId}:{yyyyMMdd},
/// and the chooser select reflect:pick:{userId}:{yyyyMMdd} (habit id values) shown when several habits are open.
/// </summary>
public class ReflectDismissModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;
    private readonly IConfiguration _config;

    public ReflectDismissModule(HabitService habits, IConfiguration config)
    {
        _habits = habits;
        _config = config;
    }

    [ComponentInteraction("reflect:dismiss:*")]
    public async Task DismissAsync(string userId)
    {
        await RespondAsync("Noted. Today is a fresh start. 💙", ephemeral: true);

        // Delete the original DM message so the user's DMs stay clean.
        try
        {
            if (Context.Interaction is SocketMessageComponent component)
                await component.Message.DeleteAsync();
        }
        catch { /* Message may already be gone */ }
    }

    [ComponentInteraction("reflect:log:*:*")]
    public async Task LogAsync(string ownerIdStr, string dateStr)
    {
        if (!IsOwner(ownerIdStr)) { await NotYoursAsync(); return; }
        if (!TryParseDate(dateStr, out var date)) { await BadIdAsync(); return; }

        var open = await OpenHabitsAsync(_habits, Context.User.Id, date);
        if (open.Count == 0)
        {
            await CloseAsync("That day is already logged. 💙");
            return;
        }

        if (open.Count == 1)
        {
            if (await _habits.CheckInAsync(Context.User.Id, open[0].Id, date, completed: true) != DayEditResult.Saved)
            {
                await RespondAsync("Couldn't find that habit.", ephemeral: true);
                return;
            }
            await CloseAsync($"Logged **{open[0].Name}** for {Label(date)}. Nice. ✅");
            return;
        }

        var menu = new SelectMenuBuilder()
            .WithCustomId($"reflect:pick:{Context.User.Id}:{dateStr}")
            .WithPlaceholder("Which ones did you do?")
            .WithMinValues(1)
            .WithMaxValues(Math.Min(open.Count, 25));
        foreach (var habit in open.Take(25))
            menu.AddOption(habit.Name.Length > 100 ? habit.Name[..100] : habit.Name, habit.Id.ToString());

        await RespondAsync($"Which habits did you do on {Label(date)}?",
            components: new ComponentBuilder().WithSelectMenu(menu).Build(), ephemeral: true);
    }

    [ComponentInteraction("reflect:pick:*:*")]
    public async Task PickAsync(string ownerIdStr, string dateStr, string[] values)
    {
        if (!IsOwner(ownerIdStr)) { await NotYoursAsync(); return; }
        if (!TryParseDate(dateStr, out var date)) { await BadIdAsync(); return; }

        var logged = 0;
        foreach (var value in values)
            if (int.TryParse(value, out var habitId)
                && await _habits.CheckInAsync(Context.User.Id, habitId, date, completed: true) == DayEditResult.Saved)
                logged++;

        await CloseAsync($"Logged {logged} habit{(logged == 1 ? "" : "s")} for {Label(date)}. Nice. ✅");
    }

    [ComponentInteraction("reflect:low:*:*")]
    public async Task LowDayAsync(string ownerIdStr, string dateStr)
    {
        if (!IsOwner(ownerIdStr)) { await NotYoursAsync(); return; }
        if (!TryParseDate(dateStr, out var date)) { await BadIdAsync(); return; }

        if (await _habits.SetLowDayAsync(Context.User.Id, date) == DayEditResult.ConsentRequired)
        {
            await ConsentModule.RespondWithPromptAsync(Context, _config, _habits);
            return;
        }

        await CloseAsync($"Marked {Label(date)} as a low day. Your streaks are safe. 💙");
    }

    /// <summary>The user's daily habits that are still open to log as done on <paramref name="date"/>, in creation order.</summary>
    internal static async Task<List<Habit>> OpenHabitsAsync(HabitService habits, ulong userId, DateOnly date)
    {
        var tz = await habits.GetUserTzAsync(userId);
        return (await habits.GetHabitsAsync(userId)).Where(h => MissedDayReflectionJob.IsOpenDaily(h, date, tz)).ToList();
    }

    private async Task CloseAsync(string text) =>
        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = text;
            m.Embed      = null;
            m.Components = new ComponentBuilder().Build();
        });

    private static string Label(DateOnly date) => date.ToString("dddd d MMM", CultureInfo.InvariantCulture);

    private bool IsOwner(string ownerIdStr) => ulong.TryParse(ownerIdStr, out var ownerId) && ownerId == Context.User.Id;

    private static bool TryParseDate(string value, out DateOnly date) =>
        DateOnly.TryParseExact(value, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    private async Task NotYoursAsync() =>
        await RespondAsync("This button isn't for you.", ephemeral: true);

    private async Task BadIdAsync() =>
        await RespondAsync("Something went wrong, please try again.", ephemeral: true);
}
