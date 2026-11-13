using System.Globalization;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Jobs;
using Ember.Core.Localization;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.Extensions.Configuration;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the buttons on MissedDayReflectionJob DMs.
/// Custom IDs: reflect:dismiss:{userId}, reflect:log:{userId}:{yyyyMMdd}, reflect:low:{userId}:{yyyyMMdd},
/// and the chooser select reflect:pick:{userId}:{yyyyMMdd} (habit id values), which replaces the check-in's content when several
/// habits are open, so picking closes the check-in itself.
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
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        await RespondAsync(t.Get("reflect.dismissed"), ephemeral: true);

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
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!IsOwner(ownerIdStr)) { await NotYoursAsync(t); return; }
        if (!TryParseDate(dateStr, out var date)) { await BadIdAsync(t); return; }

        var open = await OpenHabitsAsync(_habits, Context.User.Id, date);
        if (open.Count == 0)
        {
            await CloseAsync(t.Get("reflect.already-logged"));
            return;
        }

        if (open.Count == 1)
        {
            if (await _habits.AddCheckInAsync(Context.User.Id, open[0].Id, date) != DayEditResult.Saved)
            {
                await RespondAsync(t.Get("common.not-found"), ephemeral: true);
                return;
            }
            await CloseAsync(t.Format("reflect.logged-one", open[0].Name, Label(t, date)));
            return;
        }

        var menu = new SelectMenuBuilder()
            .WithCustomId($"reflect:pick:{Context.User.Id}:{dateStr}")
            .WithPlaceholder(t.Get("reflect.pick.placeholder"))
            .WithMinValues(1)
            .WithMaxValues(Math.Min(open.Count, 25));
        foreach (var habit in open.Take(25))
            menu.AddOption(habit.Name.Length > 100 ? habit.Name[..100] : habit.Name, habit.Id.ToString());

        var components = new ComponentBuilder()
            .WithSelectMenu(menu)
            .WithButton(t.Get("reflect.low-button"), $"reflect:low:{Context.User.Id}:{dateStr}", ButtonStyle.Secondary, new Emoji("🌙"), row: 1)
            .WithButton(t.Get("reflect.move-on"), $"reflect:dismiss:{Context.User.Id}", ButtonStyle.Secondary, row: 1)
            .Build();
        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = t.Format("reflect.pick.question", Label(t, date));
            m.Embed      = null;
            m.Components = components;
        });
    }

    [ComponentInteraction("reflect:pick:*:*")]
    public async Task PickAsync(string ownerIdStr, string dateStr, string[] values)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!IsOwner(ownerIdStr)) { await NotYoursAsync(t); return; }
        if (!TryParseDate(dateStr, out var date)) { await BadIdAsync(t); return; }

        var logged = 0;
        foreach (var value in values)
            if (int.TryParse(value, out var habitId)
                && await _habits.AddCheckInAsync(Context.User.Id, habitId, date) == DayEditResult.Saved)
                logged++;

        await CloseAsync(t.Plural("reflect.logged", logged, Label(t, date)));
    }

    [ComponentInteraction("reflect:low:*:*")]
    public async Task LowDayAsync(string ownerIdStr, string dateStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!IsOwner(ownerIdStr)) { await NotYoursAsync(t); return; }
        if (!TryParseDate(dateStr, out var date)) { await BadIdAsync(t); return; }

        if (await _habits.SetLowDayAsync(Context.User.Id, date) == DayEditResult.ConsentRequired)
        {
            await ConsentModule.RespondWithPromptAsync(Context, _config, _habits);
            return;
        }

        await CloseAsync(t.Format("reflect.low-marked", Label(t, date)));
    }

    /// <summary>The user's daily and weekdays habits that are still open to log as done on <paramref name="date"/>, in creation order.</summary>
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

    private static string Label(Texts t, DateOnly date) => date.ToString(t.Get("date.long"), t.Culture);

    private bool IsOwner(string ownerIdStr) => ulong.TryParse(ownerIdStr, out var ownerId) && ownerId == Context.User.Id;

    private static bool TryParseDate(string value, out DateOnly date) =>
        DateOnly.TryParseExact(value, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    private async Task NotYoursAsync(Texts t) =>
        await RespondAsync(t.Get("common.not-yours"), ephemeral: true);

    private async Task BadIdAsync(Texts t) =>
        await RespondAsync(t.Get("common.retry.comma"), ephemeral: true);
}
