using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Data;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the onboarding "Set my timezone first" button flow that appears after
/// /habit add and /habit template when the user has no timezone configured yet.
/// Custom ID patterns:
///   onboard:timezone:{habitId}          (button)
///   onboard:tz:modal:{habitId}:{msgId}  (modal submit)
/// </summary>
public class OnboardingModule : InteractionModuleBase<SocketInteractionContext>
{
    private readonly EmberDbContext _db;
    private readonly HabitService _habits;

    public OnboardingModule(EmberDbContext db, HabitService habits)
    {
        _db    = db;
        _habits = habits;
    }

    // ── "Set my timezone first" button ────────────────────────────────────────

    [ComponentInteraction("onboard:timezone:*")]
    public async Task OnTimezoneButtonAsync(string habitIdStr)
    {
        var sourceMessageId = ((SocketMessageComponent)Context.Interaction).Message.Id;

        var modal = new ModalBuilder()
            .WithTitle("Set your timezone")
            .WithCustomId($"onboard:tz:modal:{habitIdStr}:{sourceMessageId}")
            .AddTextInput(
                "Your timezone (IANA name)",
                "tz_id",
                placeholder: "e.g. Europe/Amsterdam, America/New_York, Asia/Tokyo",
                minLength: 3, maxLength: 60, required: true)
            .Build();

        await RespondWithModalAsync(modal);

        // Strip the buttons from the original message so it can't be double-clicked.
        try { await DeleteOriginalResponseAsync(); } catch { /* ignore */ }
    }

    // ── Timezone modal submit ─────────────────────────────────────────────────

    [ModalInteraction("onboard:tz:modal:*:*")]
    public async Task OnTimezoneModalAsync(string habitIdStr, string sourceMessageIdStr, TimezoneOnboardModal modal)
    {
        var tz = TimezoneHelper.Find(modal.TimezoneId.Trim());

        if (tz is null)
        {
            await RespondAsync(
                $"Couldn't find timezone `{modal.TimezoneId.Trim()}`.\n" +
                "Use an IANA name, e.g. `Europe/Amsterdam`, `America/New_York`, `Asia/Tokyo`.\n" +
                "Full list: <https://en.wikipedia.org/wiki/List_of_tz_database_time_zones>",
                ephemeral: true);
            return;
        }

        await _habits.EnsureUserAsync(Context.User.Id);

        var user = await _db.Users.FirstAsync(u => u.DiscordUserId == (long)Context.User.Id);
        user.Timezone = tz.Id;
        await _db.SaveChangesAsync();

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle("🌍 Timezone saved!")
            .WithDescription($"Set to **{tz.Id}**.\n\nWant me to nudge you at a set time each day?")
            .Build();

        var components = new ComponentBuilder()
            .WithButton("⏰ Set a reminder", $"reminder:set:{habitIdStr}", ButtonStyle.Primary)
            .WithButton("Skip for now", $"reminder:skip:{habitIdStr}", ButtonStyle.Secondary)
            .Build();

        await RespondAsync(embed: embed, components: components, ephemeral: true);
    }
}

public class TimezoneOnboardModal : IModal
{
    public string Title => "Set your timezone";

    [InputLabel("Your timezone (IANA name)")]
    [ModalTextInput("tz_id", placeholder: "e.g. Europe/Amsterdam, America/New_York, Asia/Tokyo")]
    public string TimezoneId { get; set; } = "";
}
