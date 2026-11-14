using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Ember.Core.Data;
using Ember.Core.Localization;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.AspNetCore.Identity;

namespace Ember.Api;

/// <summary>The signed-in account: settings, consent, export and deletion.</summary>
internal static class MeEndpoints
{
    public sealed record DiscordDto(bool Linked, string? Id);
    public sealed record ConsentDto(bool Given, string? PolicyVersion, string CurrentPolicyVersion);
    public sealed record DmRemindersDto(bool Paused);

    public sealed record MeDto(
        Guid Id, string? Email, bool EmailConfirmed, bool HasPassword, DiscordDto Discord,
        string Timezone, bool TimezoneSet, DateOnly LocalToday, int GraceDaysPerWeek, string? Theme, int SecondReminderMinutes,
        bool ShowStreaks, string Language, bool CalmMode, ConsentDto Consent, DmRemindersDto DmReminders, JournalState Journal,
        string[] TipsSeen);

    public sealed record MePatch(string? Timezone, int? GraceDaysPerWeek, string? Theme, int? SecondReminderMinutes, bool? ShowStreaks,
        string? Language, bool? CalmMode);
    public sealed record ConsentRequest(string? PolicyVersion);
    public sealed record DeleteRequest(string? Password, string? Confirm);

    public static RouteGroupBuilder MapMe(this RouteGroupBuilder api)
    {
        api.MapGet("/me", async (ClaimsPrincipal principal, UserManager<User> users, HabitService habits, TimeProvider time) =>
            await LoadMe(principal, users, habits, time) is { } me ? Results.Ok(me) : Problems.Unauthenticated());

        api.MapPatch("/me", async (JsonElement body, ClaimsPrincipal principal, UserManager<User> users, HabitService habits,
            EmberDbContext db, TimeProvider time) =>
        {
            MePatch? patch;
            try
            {
                patch = body.Deserialize<MePatch>(JsonSerializerOptions.Web);
            }
            catch (JsonException e)
            {
                return Problems.Validation(e.Path is { Length: > 2 } path ? path[2..] : "body", "Has the wrong type or format.");
            }
            if (patch is null) return Problems.Validation("body", "Must be a JSON object.");

            var errors = new Dictionary<string, string[]>();
            TimeZoneInfo? zone = null;
            if (patch.Timezone is not null && (!TimeZoneInfo.TryFindSystemTimeZoneById(patch.Timezone, out zone) || !zone.HasIanaId))
                errors["timezone"] = ["Unknown IANA timezone."];
            ValidateGraceAndTheme(patch.GraceDaysPerWeek, patch.Theme, errors);
            ValidateSecondReminder(patch.SecondReminderMinutes, errors);
            ValidateLanguage(patch.Language, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            var userId = principal.UserId();
            db.ChangeTracker.Clear();
            if (patch.GraceDaysPerWeek is { } grace) await habits.SetGraceDaysAsync(userId, grace);
            if (patch.Theme is { } theme) await habits.SetThemeAsync(userId, theme);
            if (patch.SecondReminderMinutes is { } second) await habits.SetSecondReminderMinutesAsync(userId, second);
            if (patch.ShowStreaks is { } showStreaks) await habits.SetShowStreaksAsync(userId, showStreaks);
            if (patch.Language is { } language) await habits.SetLanguageAsync(userId, language);
            if (patch.CalmMode is { } calmMode) await habits.SetCalmModeAsync(userId, calmMode);
            if (zone is not null)
            {
                await habits.SetTimezoneAsync(userId, zone.Id);
                await habits.RescheduleRemindersAsync(userId);
            }

            return await LoadMe(principal, users, habits, time) is { } me ? Results.Ok(me) : Problems.Unauthenticated();
        });

        api.MapPost("/me/consent", async (ConsentRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            if (request.PolicyVersion != HabitService.CurrentConsentPolicyVersion)
                return Problems.Validation("policyVersion", "Not the current policy version.");

            await habits.GiveHealthDataConsentAsync(principal.UserId());
            return Results.NoContent();
        });

        api.MapPut("/me/tips/{id}", async (string id, ClaimsPrincipal principal, HabitService habits) =>
        {
            if (!User.TipIds.Contains(id)) return Problems.Validation("id", "Unknown tip.");

            await habits.MarkTipSeenAsync(principal.UserId(), id);
            return Results.NoContent();
        });

        api.MapPost("/me/dm-reminders/resume", async (ClaimsPrincipal principal, HabitService habits) =>
        {
            await habits.ResumeDmRemindersAsync(principal.UserId());
            return Results.NoContent();
        });

        api.MapGet("/me/export", async (string? format, ClaimsPrincipal principal, HabitService habits, TimeProvider time) =>
        {
            if (format is not (null or "json" or "csv"))
                return Problems.Validation("format", "Must be json or csv.");

            var user = await habits.GetUserForExportAsync(principal.UserId());
            if (user is null) return Problems.NotFound();

            var (content, contentType, extension) = format == "csv"
                ? (ExportBuilder.BuildCsv(user), "text/csv", "csv")
                : (ExportBuilder.BuildJson(user), "application/json", "json");
            return Results.File(Encoding.UTF8.GetBytes(content), contentType,
                $"ember-export-{time.GetUtcNow():yyyy-MM-dd}.{extension}");
        });

        api.MapPost("/me/delete", async (DeleteRequest request, ClaimsPrincipal principal, UserManager<User> users,
            SignInManager<User> signIn, HabitService habits, AuthSessions sessions) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Problems.Unauthenticated();

            if (await users.HasPasswordAsync(user))
            {
                if (!(await signIn.CheckPasswordSignInAsync(user, request.Password ?? "", lockoutOnFailure: true)).Succeeded)
                    return Problems.Validation("password", "The password is not correct.");
            }
            else if (request.Confirm != "DELETE")
            {
                return Problems.Validation("confirm", "Type DELETE to confirm.");
            }

            await sessions.EndAllAsync(user.Id);
            await habits.DeleteUserDataAsync(user.Id);
            await signIn.SignOutAsync();
            return Results.NoContent();
        });

        return api;
    }

    internal static void ValidateGraceAndTheme(int? graceDaysPerWeek, string? theme, Dictionary<string, string[]> errors)
    {
        if (graceDaysPerWeek is < 0 or > 3)
            errors["graceDaysPerWeek"] = ["Must be between 0 and 3."];
        if (theme is not null && !User.Themes.Contains(theme))
            errors["theme"] = ["Unknown theme."];
    }

    internal static void ValidateSecondReminder(int? minutes, Dictionary<string, string[]> errors)
    {
        if (minutes is { } m && !User.SecondReminderChoices.Contains(m))
            errors["secondReminderMinutes"] = ["Must be 0, 15, 30, 60 or 120."];
    }

    internal static void ValidateLanguage(string? language, Dictionary<string, string[]> errors)
    {
        if (language is not null && !Languages.All.Contains(language))
            errors["language"] = ["Must be en or de."];
    }

    private static async Task<MeDto?> LoadMe(ClaimsPrincipal principal, UserManager<User> users, HabitService habits, TimeProvider time)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null) return null;

        var discordId = (await users.GetLoginsAsync(user)).FirstOrDefault(l => l.LoginProvider == DiscordLogin.Provider)?.ProviderKey;
        return new MeDto(
            user.Id, user.Email, user.EmailConfirmed, await users.HasPasswordAsync(user),
            new DiscordDto(discordId is not null, discordId),
            user.Timezone, await habits.HasTimezoneSetAsync(user.Id), TimezoneHelper.LocalToday(user.Timezone, time),
            user.GraceDaysPerWeek, user.Theme, user.SecondReminderMinutes, user.ShowStreaks, user.Language, user.CalmMode,
            new ConsentDto(await habits.HasHealthDataConsentAsync(user.Id), user.ConsentPolicyVersion, HabitService.CurrentConsentPolicyVersion),
            new DmRemindersDto(user.DmRemindersPausedAt is not null),
            await habits.GetJournalStateAsync(user.Id),
            [.. user.TipsSeen]);
    }
}
