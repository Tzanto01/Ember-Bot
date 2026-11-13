using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Core.Localization;
using Ember.Core.Services;

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
    private readonly HabitService _habits;

    public OnboardingModule(HabitService habits)
    {
        _habits = habits;
    }

    // ── Static timezone data ──────────────────────────────────────────────────

    private static readonly (string Id, string Emoji)[] Regions =
    [
        ("americas", "🌎"),
        ("europe",   "🌍"),
        ("asia",     "🌏"),
        ("pacific",  "🌏"),
        ("africa",   "🌍"),
        ("utc",      "🌐"),
    ];

    private static readonly Dictionary<string, string[]> Timezones = new()
    {
        ["americas"] =
        [
            "America/New_York",
            "America/Chicago",
            "America/Denver",
            "America/Los_Angeles",
            "America/Anchorage",
            "Pacific/Honolulu",
            "America/Toronto",
            "America/Vancouver",
            "America/Mexico_City",
            "America/Bogota",
            "America/Lima",
            "America/Caracas",
            "America/Santiago",
            "America/Sao_Paulo",
            "America/Argentina/Buenos_Aires",
        ],
        ["europe"] =
        [
            "Europe/London",
            "Europe/Dublin",
            "Europe/Lisbon",
            "Europe/Paris",
            "Europe/Berlin",
            "Europe/Amsterdam",
            "Europe/Brussels",
            "Europe/Madrid",
            "Europe/Rome",
            "Europe/Zurich",
            "Europe/Stockholm",
            "Europe/Oslo",
            "Europe/Copenhagen",
            "Europe/Helsinki",
            "Europe/Warsaw",
            "Europe/Prague",
            "Europe/Vienna",
            "Europe/Athens",
            "Europe/Bucharest",
            "Europe/Kiev",
            "Europe/Istanbul",
            "Europe/Moscow",
        ],
        ["asia"] =
        [
            "Asia/Jerusalem",
            "Asia/Beirut",
            "Asia/Riyadh",
            "Asia/Dubai",
            "Asia/Tehran",
            "Asia/Karachi",
            "Asia/Kolkata",
            "Asia/Kathmandu",
            "Asia/Dhaka",
            "Asia/Bangkok",
            "Asia/Jakarta",
            "Asia/Singapore",
            "Asia/Kuala_Lumpur",
            "Asia/Manila",
            "Asia/Shanghai",
            "Asia/Hong_Kong",
            "Asia/Taipei",
            "Asia/Seoul",
            "Asia/Tokyo",
            "Asia/Vladivostok",
        ],
        ["pacific"] =
        [
            "Australia/Perth",
            "Australia/Adelaide",
            "Australia/Brisbane",
            "Australia/Sydney",
            "Australia/Melbourne",
            "Pacific/Auckland",
            "Pacific/Fiji",
            "Pacific/Guam",
        ],
        ["africa"] =
        [
            "Africa/Casablanca",
            "Africa/Accra",
            "Africa/Lagos",
            "Africa/Cairo",
            "Africa/Nairobi",
            "Africa/Johannesburg",
            "Indian/Mauritius",
        ],
        ["utc"] =
        [
            "UTC",
            "Etc/GMT+12",
            "Etc/GMT+11",
            "Etc/GMT+10",
            "Etc/GMT+9",
            "Etc/GMT+8",
            "Etc/GMT+7",
            "Etc/GMT+6",
            "Etc/GMT+5",
            "Etc/GMT+4",
            "Etc/GMT+3",
            "Etc/GMT+2",
            "Etc/GMT+1",
            "Etc/GMT-1",
            "Etc/GMT-2",
            "Etc/GMT-3",
            "Etc/GMT-4",
            "Etc/GMT-5",
            "Etc/GMT-6",
            "Etc/GMT-7",
            "Etc/GMT-8",
            "Etc/GMT-9",
            "Etc/GMT-10",
            "Etc/GMT-11",
            "Etc/GMT-12",
        ],
    };

    // ── Step 1: button → region picker ────────────────────────────────────────

    [ComponentInteraction("onboard:timezone:*")]
    public async Task OnTimezoneButtonAsync(string habitIdStr)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        var menu = new SelectMenuBuilder()
            .WithCustomId($"onboard:region:{habitIdStr}")
            .WithPlaceholder(t.Get("onboard.region.placeholder"));

        foreach (var (id, emoji) in Regions)
            menu.AddOption(t.Get($"onboard.region.{id}"), id, emote: new Emoji(emoji));

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = t.Get("onboard.region.question");
            m.Embed      = null;
            m.Components = new ComponentBuilder().WithSelectMenu(menu).Build();
        });
    }

    // ── Step 2: region → timezone picker ─────────────────────────────────────

    [ComponentInteraction("onboard:region:*")]
    public async Task OnRegionSelectAsync(string habitIdStr, string[] selected)
    {
        var region = selected[0];
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        if (!Timezones.TryGetValue(region, out var tzList))
        {
            await RespondAsync(t.Get("onboard.region.unknown"), ephemeral: true);
            return;
        }

        var menu = new SelectMenuBuilder()
            .WithCustomId($"onboard:tz:{habitIdStr}")
            .WithPlaceholder(t.Get("onboard.tz.placeholder"));

        foreach (var id in tzList)
            menu.AddOption(t.Get($"onboard.tz.{id}"), id);

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = t.Get("onboard.tz.question");
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
            await RespondAsync((await BotTexts.ForAsync(_habits, Context.Interaction)).Get("onboard.tz.unknown"), ephemeral: true);
            return;
        }

        await _habits.SetTimezoneAsync(Context.User.Id, tz.Id, Languages.FromLocale(Context.Interaction.UserLocale));
        await _habits.RescheduleRemindersAsync(Context.User.Id);
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);

        var embed = new EmbedBuilder()
            .WithColor(0xE8873A)
            .WithTitle(t.Get("onboard.tz.saved.title"))
            .WithDescription(t.Format("onboard.tz.saved.body", tz.Id))
            .Build();

        var components = new ComponentBuilder()
            .WithButton(t.Get("onboard.set-reminder"),   $"reminder:set:{habitIdStr}", ButtonStyle.Primary)
            .WithButton(t.Get("common.skip-for-now"),    $"reminder:skip:{habitIdStr}", ButtonStyle.Secondary)
            .Build();

        await ((SocketMessageComponent)Context.Interaction).UpdateAsync(m =>
        {
            m.Content    = "";
            m.Embed      = embed;
            m.Components = components;
        });
    }
}
