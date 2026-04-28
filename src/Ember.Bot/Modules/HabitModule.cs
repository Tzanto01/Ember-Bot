using Discord;
using Discord.Interactions;
using Ember.Bot.Services;

namespace Ember.Bot.Modules;

[Group("habit", "Track your habits")]
public class HabitModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly HabitService _habits;

    public HabitModule(HabitService habits)
    {
        _habits = habits;
    }

    private async Task<string> FormatReminderAsync(TimeOnly? utcTime)
    {
        if (!utcTime.HasValue) return "None set";
        var tz    = await _habits.GetUserTzAsync(Context.User.Id);
        var local = TimezoneHelper.ToLocal(utcTime.Value, tz);
        return $"{local:HH:mm} ({tz.Id})";
    }

    // ── /habit add ────────────────────────────────────────────────────────────

    [SlashCommand("add", "Add a new habit to track")]
    public async Task AddAsync(
        [Summary("name", "What habit do you want to track?")] string name,
        [Summary("reminder", "Daily reminder time in HH:mm in your local timezone (optional)")] string? reminder = null)
    {
        TimeOnly? reminderTime = null;
        if (reminder is not null)
        {
            if (!TimeOnly.TryParseExact(reminder, "HH:mm", out var parsed))
            {
                await RespondAsync("Couldn't parse that time. Use HH:mm format, e.g. `09:00`.", ephemeral: true);
                return;
            }
            reminderTime = parsed;
        }

        var habit = await _habits.AddHabitAsync(Context.User.Id, name, reminderTime);

        var embed = new EmbedBuilder()
            .WithColor(0xF4845F)
            .WithTitle("Habit added!")
            .WithDescription($"**{habit.Name}** is now being tracked.")
            .AddField("Reminder", await FormatReminderAsync(habit.ReminderTime), inline: true)
            .WithFooter("You've got this. One day at a time.")
            .Build();

        await RespondAsync(embed: embed, ephemeral: true);
    }

    // ── /habit list ───────────────────────────────────────────────────────────

    [SlashCommand("list", "See all your habits and their recent progress")]
    public async Task ListAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        if (habits.Count == 0)
        {
            await RespondAsync("You don't have any habits yet. Use `/habit add` to get started!", ephemeral: true);
            return;
        }

        var embed = new EmbedBuilder()
            .WithColor(0xF4845F)
            .WithTitle("Your Habits");

        foreach (var h in habits)
        {
            var flexible = HabitService.FlexibleStreak(h, 7);
            var best = HabitService.BestStreak(h);
            var checkedToday = h.Logs.Any(l => l.Date == DateOnly.FromDateTime(DateTime.UtcNow) && l.Completed);
            var todayMark = checkedToday ? "✅" : "⬜";
            var reminderStr = await FormatReminderAsync(h.ReminderTime);

            embed.AddField(
                $"{todayMark} {h.Name} (ID: {h.Id})",
                $"Last 7 days: **{flexible}/7** · Best streak: **{best}**\nReminder: {reminderStr}",
                inline: false);
        }

        embed.WithFooter("Progress over perfection.");
        await RespondAsync(embed: embed.Build(), ephemeral: true);
    }

    // ── /habit checkin ────────────────────────────────────────────────────────

    [SlashCommand("checkin", "Log today's check-in for a habit")]
    public async Task CheckInAsync(
        [Summary("habit_id", "The ID of the habit (from /habit list)")] int habitId,
        [Summary("completed", "Did you do it today?")] bool completed = true)
    {
        var log = await _habits.CheckInAsync(Context.User.Id, habitId, completed);

        if (log is null)
        {
            await RespondAsync("Couldn't find that habit. Use `/habit list` to see your habit IDs.", ephemeral: true);
            return;
        }

        var message = completed
            ? "Nice work! Logged as done for today. ✅"
            : "No worries — logged. Tomorrow's a fresh start. 💙";

        await RespondAsync(message, ephemeral: true);
    }

    // ── /habit streak ─────────────────────────────────────────────────────────

    [SlashCommand("streak", "See your personal habit stats")]
    public async Task StreakAsync()
    {
        var habits = await _habits.GetHabitsAsync(Context.User.Id);

        if (habits.Count == 0)
        {
            await RespondAsync("No habits tracked yet. Use `/habit add` to begin!", ephemeral: true);
            return;
        }

        var embed = new EmbedBuilder()
            .WithColor(0xF4845F)
            .WithTitle("Your Habit Stats");

        foreach (var h in habits)
        {
            var last7 = HabitService.FlexibleStreak(h, 7);
            var last30 = HabitService.FlexibleStreak(h, 30);
            var best = HabitService.BestStreak(h);
            var total = h.Logs.Count(l => l.Completed);

            embed.AddField(
                $"🔥 {h.Name}",
                $"Last 7 days: **{last7}/7**\nLast 30 days: **{last30}/30**\nBest streak: **{best}** days\nTotal check-ins: **{total}**",
                inline: true);
        }

        embed.WithFooter("Every check-in counts, no matter the gap.");
        await RespondAsync(embed: embed.Build(), ephemeral: true);
    }

    // ── /habit delete ─────────────────────────────────────────────────────────

    [SlashCommand("delete", "Remove a habit and stop tracking it")]
    public async Task DeleteAsync(
        [Summary("habit_id", "The ID of the habit to delete (from /habit list)")] int habitId)
    {
        var deleted = await _habits.DeleteHabitAsync(Context.User.Id, habitId);

        if (!deleted)
        {
            await RespondAsync("Couldn't find that habit. Use `/habit list` to see your habit IDs.", ephemeral: true);
            return;
        }

        await RespondAsync("Habit removed. No judgement — you can always start fresh with `/habit add`. 💙", ephemeral: true);
    }

    // ── /habit edit ───────────────────────────────────────────────────────────

    [SlashCommand("edit", "Edit a habit's name or reminder time")]
    public async Task EditAsync(
        [Summary("habit_id", "The ID of the habit to edit")] int habitId,
        [Summary("name", "New name for the habit")] string? name = null,
        [Summary("reminder", "New reminder time in HH:mm UTC")] string? reminder = null,
        [Summary("clear_reminder", "Remove the reminder entirely")] bool clearReminder = false)
    {
        TimeOnly? reminderTime = null;
        if (reminder is not null)
        {
            if (!TimeOnly.TryParseExact(reminder, "HH:mm", out var parsed))
            {
                await RespondAsync("Couldn't parse that time. Use HH:mm format, e.g. `09:00`.", ephemeral: true);
                return;
            }
            reminderTime = parsed;
        }

        var habit = await _habits.EditHabitAsync(Context.User.Id, habitId, name, reminderTime, clearReminder);

        if (habit is null)
        {
            await RespondAsync("Couldn't find that habit. Use `/habit list` to see your habit IDs.", ephemeral: true);
            return;
        }

        var embed = new EmbedBuilder()
            .WithColor(0xF4845F)
            .WithTitle("Habit updated!")
            .AddField("Name", habit.Name, inline: true)
            .AddField("Reminder", await FormatReminderAsync(habit.ReminderTime), inline: true)
            .Build();

        await RespondAsync(embed: embed, ephemeral: true);
    }
}
