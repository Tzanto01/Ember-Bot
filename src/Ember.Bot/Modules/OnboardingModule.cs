using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Data;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;

namespace Ember.Bot.Modules;

/// <summary>
/// Handles the "Set my timezone first" onboarding flow that appears after
/// /habit add and /habit template when the user has no timezone configured.
///
/// Flow: onboard:timezone:{habitId} button
///         → region select menu  (onboard:region:{habitId})
///         → timezone select menu (onboard:tz:{habitId})
///         → save + show reminder setup buttons
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

    // ── Static timezone data ──────────────────────────────────────────────────

    private static readonly (string Id, string Label, string Emoji)[] Regions =
    [
        ("americas", "Americas",             "🌎"),
        ("europe",   "Europe",               "🌍"),
        ("asia",     "Asia",                 "🌏"),
        ("pacific",  "Pacific & Oceania",    "🌏"),
        ("africa",   "Africa & Middle East", "🌍"),
        ("utc",      "UTC / Fixed Offset",   "🌐"),
    ];

    private static readonly Dictionary<string, (string Id, string Label)[]> Timezones = new()
    {
        ["americas"] =
        [
            ("America/New_York",               "Eastern Time — New York"),
            ("America/Chicago",                "Central Time — Chicago"),
            ("America/Denver",                 "Mountain Time — Denver"),
            ("America/Los_Angeles",            "Pacific Time — Los Angeles"),
            ("America/Anchorage",              "Alaska Time"),
            ("Pacific/Honolulu",               "Hawaii Time"),
            ("America/Toronto",                "Toronto"),
            ("America/Vancouver",              "Vancouver"),
            ("America/Mexico_City",            "Mexico City"),
            ("America/Bogota",                 "Bogotá"),
            ("America/Lima",                   "Lima"),
            ("America/Caracas",                "Caracas"),
            ("America/Santiago",               "Santiago"),
            ("America/Sao_Paulo",              "São Paulo"),
            ("America/Argentina/Buenos_Aires", "Buenos Aires"),
        ],
        ["europe"] =
        [
            ("Europe/London",     "London"),
            ("Europe/Dublin",     "Dublin"),
            ("Europe/Lisbon",     "Lisbon"),
            ("Europe/Paris",      "Paris"),
            ("Europe/Berlin",     "Berlin"),
            ("Europe/Amsterdam",  "Amsterdam"),
            ("Europe/Brussels",   "Brussels"),
            ("Europe/Madrid",     "Madrid"),
            ("Europe/Rome",       "Rome"),
            ("Europe/Zurich",     "Zurich"),
            ("Europe/Stockholm",  "Stockholm"),
            ("Europe/Oslo",       "Oslo"),
            ("Europe/Copenhagen", "Copenhagen"),
            ("Europe/Helsinki",   "Helsinki"),
            ("Europe/Warsaw",     "Warsaw"),
            ("Europe/Prague",     "Prague"),
            ("Europe/Vienna",     "Vienna"),
            ("Europe/Athens",     "Athens"),
            ("Europe/Bucharest",  "Bucharest"),
            ("Europe/Kiev",       "Kyiv"),
            ("Europe/Istanbul",   "Istanbul"),
            ("Europe/Moscow",     "Moscow"),
        ],
        ["asia"] =
        [
            ("Asia/Jerusalem",   "Jerusalem"),
            ("Asia/Beirut",      "Beirut"),
            ("Asia/Riyadh",      "Riyadh"),
            ("Asia/Dubai",       "Dubai"),
            ("Asia/Tehran",      "Tehran"),
            ("Asia/Karachi",     "Karachi"),
            ("Asia/Kolkata",     "India — IST"),
            ("Asia/Kathmandu",   "Nepal"),
            ("Asia/Dhaka",       "Bangladesh"),
            ("Asia/Bangkok",     "Bangkok"),
            ("Asia/Jakarta",     "Jakarta"),
            ("Asia/Singapore",   "Singapore"),
            ("Asia/Kuala_Lumpur","Kuala Lumpur"),
            ("Asia/Manila",      "Manila"),
            ("Asia/Shanghai",    "China — CST"),
            ("Asia/Hong_Kong",   "Hong Kong"),
            ("Asia/Taipei",      "Taipei"),
            ("Asia/Seoul",       "Seoul"),
            ("Asia/Tokyo",       "Tokyo"),
            ("Asia/Vladivostok", "Vladivostok"),
        ],
        ["pacific"] =
        [
            ("Australia/Perth",    "Perth"),
            ("Australia/Adelaide", "Adelaide"),
            ("Australia/Brisbane", "Brisbane"),
            ("Australia/Sydney",   "Sydney"),
            ("Australia/Melbourne","Melbourne"),
            ("Pacific/Auckland",   "Auckland"),
            ("Pacific/Fiji",       "Fiji"),
            ("Pacific/Guam",       "Guam"),
        ],
        ["africa"] =
        [
            ("Africa/Casablanca",   "Casablanca"),
            ("Africa/Accra",        "Accra — UTC+0"),
            ("Africa/Lagos",        "Lagos"),
            ("Africa/Cairo",        "Cairo"),
            ("Africa/Nairobi",      "Nairobi"),
            ("Africa/Johannesburg", "Johannesburg"),
            ("Indian/Mauritius",    "Mauritius"),
        ],
        ["utc"] =
        [
            ("UTC",      "UTC — Coordinated Universal Time"),
            ("Etc/GMT+12","UTC−12"),
            ("Etc/GMT+11","UTC−11"),
            ("Etc/GMT+10","UTC−10"),
            ("Etc/GMT+9", "UTC−9"),
            ("Etc/GMT+8", "UTC−8"),
            ("Etc/GMT+7", "UTC−7"),
            ("Etc/GMT+6", "UTC−6"),
            ("Etc/GMT+5", "UTC−5"),
            ("Etc/GMT+4", "UTC−4"),
            ("Etc/GMT+3", "UTC−3"),
            ("Etc/GMT+2", "UTC−2"),
            ("Etc/GMT+1", "UTC−1"),
            ("Etc/GMT-1", "UTC+1"),
            ("Etc/GMT-2", "UTC+2"),
            ("Etc/GMT-3", "UTC+3"),
            ("Etc/GMT-4", "UTC+4"),
            ("Etc/GMT-5", "UTC+5"),
            ("Etc/GMT-6", "UTC+6"),
            ("Etc/GMT-7", "UTC+7"),
            ("Etc/GMT-8", "UTC+8"),
            ("Etc/GMT-9", "UTC+9"),
            ("Etc/GMT-10","UTC+10"),
            ("Etc/GMT-11","UTC+11"),
            ("Etc/GMT-12","UTC+12"),
        ],
    };

    // ── Step 1: button → region picker ────────────────────────────────────────

    [ComponentInteraction("onboard:timezone:*")]
    public async Task OnTimezoneButtonAsync(string habitIdStr)
    {
        var menu = new SelectMenuBuilder()
            .WithCustomId($"onboard:region:{habitIdStr}")
            .WithPlaceholder("Pick your region…");

        foreach (var (id, label, emoji) in Regions)
            menu.AddOption(label, id, emote: new Emoji(emoji));

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = "Which region are you in?";
            m.Embed      = null;
            m.Components = new ComponentBuilder().WithSelectMenu(menu).Build();
        });
    }

    // ── Step 2: region → timezone picker ─────────────────────────────────────

    [ComponentInteraction("onboard:region:*")]
    public async Task OnRegionSelectAsync(string habitIdStr, string[] selected)
    {
        var region = selected[0];

        if (!Timezones.TryGetValue(region, out var tzList))
        {
            await RespondAsync("Unknown region — please try again.", ephemeral: true);
            return;
        }

        var menu = new SelectMenuBuilder()
            .WithCustomId($"onboard:tz:{habitIdStr}")
            .WithPlaceholder("Pick your timezone…");

        foreach (var (id, label) in tzList)
            menu.AddOption(label, id);

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = "Which timezone?";
            m.Embed      = null;
            m.Components = new ComponentBuilder().WithSelectMenu(menu).Build();
        });
    }

    // ── Step 3: timezone selected → save + reminder prompt ───────────────────

    [ComponentInteraction("onboard:tz:*")]
    public async Task OnTimezoneSelectAsync(string habitIdStr, string[] selected)
    {
        var tzId = selected[0];
        var tz   = TimezoneHelper.Find(tzId);

        if (tz is null)
        {
            await RespondAsync("Couldn't resolve that timezone — please try again.", ephemeral: true);
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
            .WithButton("Skip for now",      $"reminder:skip:{habitIdStr}", ButtonStyle.Secondary)
            .Build();

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = "";
            m.Embed      = embed;
            m.Components = components;
        });
    }
}
