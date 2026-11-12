using System.Buffers;
using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using Ember.Core.Models;
using Ember.Core.Services;

namespace Ember.Api;

/// <summary>Where Ember reminds the signed-in user: Discord DMs, each browser and each phone, with their on/off switch.</summary>
internal static partial class ReminderDestinationEndpoints
{
    public sealed record ReminderDestinationDto(string Id, string Kind, string Label, bool Enabled, bool Current);
    public sealed record SetDestinationRequest(bool? Enabled);
    public sealed record PhoneRequest(string? InstallId, string? Label);

    public const int MaxPhoneLabelLength = 60;
    public const string DiscordLabel = "Discord DMs";
    public const string FallbackPhoneLabel = "Android phone";

    [GeneratedRegex(@"\A[A-Za-z0-9_-]{16,64}\z")]
    private static partial Regex InstallIdPattern();

    public static RouteGroupBuilder MapReminderDestinations(this RouteGroupBuilder api)
    {
        api.MapGet("/me/reminder-destinations", async (ClaimsPrincipal principal, HabitService habits) =>
            await habits.GetUserWithDestinationsAsync(principal.UserId()) is { } user
                ? Results.Ok(ToDtos(user, AuthSessions.IdOf(principal)))
                : Problems.Unauthenticated());

        api.MapPatch("/me/reminder-destinations/{id}", async (string id, SetDestinationRequest request, ClaimsPrincipal principal,
            HabitService habits) =>
        {
            if (request.Enabled is not { } enabled) return Problems.Validation("enabled", "Required.");

            var userId = principal.UserId();
            if (!await habits.SetReminderDestinationAsync(userId, id, enabled)) return Problems.NotFound();
            return await habits.GetUserWithDestinationsAsync(userId) is { } user
                && ToDtos(user, AuthSessions.IdOf(principal)).FirstOrDefault(d => d.Id == id) is { } destination
                    ? Results.Ok(destination)
                    : Problems.NotFound();
        });

        api.MapPost("/me/phones", async (PhoneRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (request.InstallId is null || !InstallIdPattern().IsMatch(request.InstallId))
                errors["installId"] = ["Must be 16 to 64 characters of A-Z, a-z, 0-9, _ and -."];
            var label = request.Label?.Trim() ?? "";
            if (label.Length > MaxPhoneLabelLength) errors["label"] = [$"At most {MaxPhoneLabelLength} characters."];
            else if (HasHiddenOrBrokenChar(label)) errors["label"] = ["Can't contain control or formatting characters."];
            var sessionId = AuthSessions.IdOf(principal);
            if (sessionId is null) errors["session"] = ["Sign in again to register this phone."];
            if (errors.Count > 0) return Problems.Validation(errors);

            var phone = await habits.SaveReminderPhoneAsync(principal.UserId(), request.InstallId!,
                label.Length > 0 ? label : FallbackPhoneLabel, sessionId!.Value);
            return Results.Ok(new ReminderDestinationDto(ReminderDestinations.Phone(phone.Id), "phone", phone.Label, phone.Enabled, true));
        });

        return api;
    }

    /// <summary>True when <paramref name="label"/> has a control, format (bidi included) or separator character, or an unpaired surrogate.</summary>
    private static bool HasHiddenOrBrokenChar(string label)
    {
        for (var rest = label.AsSpan(); !rest.IsEmpty;)
        {
            if (Rune.DecodeFromUtf16(rest, out var rune, out var used) != OperationStatus.Done
                || Rune.GetUnicodeCategory(rune) is UnicodeCategory.Control or UnicodeCategory.Format or UnicodeCategory.LineSeparator
                    or UnicodeCategory.ParagraphSeparator)
                return true;
            rest = rest[used..];
        }
        return false;
    }

    /// <summary>The user's destinations: Discord first (only with a Discord login), then browsers, then phones, each by id.</summary>
    private static List<ReminderDestinationDto> ToDtos(User user, Guid? sessionId)
    {
        var list = new List<ReminderDestinationDto>();
        if (user.DiscordId() is not null)
            list.Add(new(ReminderDestinations.Discord, "discord", DiscordLabel, user.DiscordReminders == true, false));
        list.AddRange(user.PushSubscriptions.OrderBy(s => s.Id).Select(s => new ReminderDestinationDto(
            ReminderDestinations.Browser(s.Id), "browser", s.Label ?? BrowserLabels.Fallback, s.Enabled,
            sessionId is not null && s.SessionId == sessionId)));
        list.AddRange(user.ReminderPhones.OrderBy(p => p.Id).Select(p => new ReminderDestinationDto(
            ReminderDestinations.Phone(p.Id), "phone", p.Label, p.Enabled, sessionId is not null && p.SessionId == sessionId)));
        return list;
    }
}

/// <summary>Readable browser names ("Firefox on Linux") from a User-Agent header.</summary>
internal static class BrowserLabels
{
    public const string Fallback = "Browser";

    private static readonly (string Name, string[] Tokens)[] Browsers =
    [
        ("Samsung Internet", ["SamsungBrowser/"]),
        ("Edge", ["Edg/", "EdgA/", "EdgiOS/"]),
        ("Opera", ["OPR/"]),
        ("Firefox", ["Firefox/", "FxiOS/"]),
        ("Chrome", ["Chrome/", "CriOS/"]),
        ("Safari", ["Safari/"]),
    ];

    private static readonly (string Name, string[] Tokens)[] Systems =
    [
        ("Windows", ["Windows"]),
        ("iOS", ["iPhone", "iPad", "iPod"]),
        ("macOS", ["Macintosh", "Mac OS X"]),
        ("Android", ["Android"]),
        ("ChromeOS", ["CrOS"]),
        ("Linux", ["Linux"]),
    ];

    /// <summary>"&lt;Browser&gt; on &lt;OS&gt;" for <paramref name="userAgent"/>; an unknown part is left out, "Browser" when both are unknown.</summary>
    public static string From(string? userAgent)
    {
        var browser = Find(Browsers, userAgent);
        var system = Find(Systems, userAgent);
        return system is null ? browser ?? Fallback : $"{browser ?? Fallback} on {system}";
    }

    private static string? Find((string Name, string[] Tokens)[] candidates, string? userAgent)
        => userAgent is null
            ? null
            : candidates.FirstOrDefault(c => c.Tokens.Any(t => userAgent.Contains(t, StringComparison.Ordinal))).Name;
}
