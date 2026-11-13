using System.Security.Claims;
using Ember.Core.Models;
using Ember.Core.Services;

namespace Ember.Api;

/// <summary>The end-to-end encrypted "What helps me" list (contract "Companion extras v1.17").</summary>
internal static class HelpsEndpoints
{
    public sealed record HelpsRequest(string? Encrypted, int? Version);
    public sealed record HelpsDto(string Encrypted, int Version);
    public sealed record HelpsVersionDto(int Version);

    public static RouteGroupBuilder MapHelps(this RouteGroupBuilder api)
    {
        api.MapGet("/me/helps", async (ClaimsPrincipal principal, HabitService habits) =>
            await habits.GetHelpsAsync(principal.UserId()) is { } helps
                ? Results.Ok(new HelpsDto(helps.Encrypted, helps.Version))
                : Problems.NotFound());

        api.MapPut("/me/helps", async (HelpsRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            var userId = principal.UserId();
            if (!await habits.HasHealthDataConsentAsync(userId)) return Problems.ConsentRequired();

            var errors = new Dictionary<string, string[]>();
            if (request.Encrypted is not { Length: > 0 and <= UserHelps.MaxEncryptedLength })
                errors["encrypted"] = [$"Must be 1 to {UserHelps.MaxEncryptedLength} characters."];
            if (request.Version is not >= 0) errors["version"] = ["Must be the version you last read, 0 when there was none."];
            if (errors.Count > 0) return Problems.Validation(errors);

            var (result, version) = await habits.PutHelpsAsync(userId, request.Encrypted!, request.Version!.Value);
            return result switch
            {
                HelpsWriteResult.Saved => Results.Ok(new HelpsVersionDto(version)),
                HelpsWriteResult.JournalOff => Problems.Conflict("The private journal is off or turning off."),
                _ => Problems.Conflict("Another device saved this list meanwhile. Reload and try again."),
            };
        });

        api.MapDelete("/me/helps", async (ClaimsPrincipal principal, HabitService habits) =>
        {
            await habits.DeleteHelpsAsync(principal.UserId());
            return Results.NoContent();
        });

        return api;
    }
}
