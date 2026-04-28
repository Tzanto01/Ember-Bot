using Discord;
using Discord.Interactions;
using Ember.Bot.Data;
using Ember.Bot.Models;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;

namespace Ember.Bot.Modules;

[Group("timezone", "Manage your timezone settings")]
public class TimezoneModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly EmberDbContext _db;
    private readonly HabitService _habits;
    private readonly ReminderScheduler _scheduler;

    public TimezoneModule(EmberDbContext db, HabitService habits, ReminderScheduler scheduler)
    {
        _db        = db;
        _habits    = habits;
        _scheduler = scheduler;
    }

    [SlashCommand("set", "Set your local timezone (IANA format, e.g. Europe/Amsterdam)")]
    public async Task SetAsync(
        [Summary("timezone", "Your IANA timezone, e.g. America/New_York, Europe/London")] string tzId)
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

        await _habits.EnsureUserAsync(Context.User.Id);

        var user = await _db.Users.FirstAsync(u => u.DiscordUserId == (long)Context.User.Id);
        user.Timezone = tz.Id;
        await _db.SaveChangesAsync();

        // Reschedule any existing reminders so they fire at the correct UTC time
        var habitsWithReminders = await _db.Habits
            .Where(h => h.UserId == (long)Context.User.Id && h.ReminderTime != null)
            .ToListAsync();

        foreach (var habit in habitsWithReminders)
            await _scheduler.ScheduleAsync(habit, tz);

        await RespondAsync(
            $"Timezone set to **{tz.Id}** (UTC{tz.BaseUtcOffset:hhmm}).\n" +
            (habitsWithReminders.Count > 0
                ? $"Rescheduled {habitsWithReminders.Count} reminder(s) to match."
                : ""),
            ephemeral: true);
    }

    [SlashCommand("show", "Show your current timezone setting")]
    public async Task ShowAsync()
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.DiscordUserId == (long)Context.User.Id);
        var tzId = user?.Timezone ?? "UTC";
        var tz   = TimezoneHelper.Find(tzId) ?? TimeZoneInfo.Utc;

        await RespondAsync(
            $"Your timezone is currently **{tz.Id}** (UTC{tz.BaseUtcOffset:hhmm}).",
            ephemeral: true);
    }
}
