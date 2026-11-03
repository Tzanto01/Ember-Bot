using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.AspNetCore.Identity;

namespace Ember.Api;

/// <summary>Confirming or cancelling the merge of a bot-only account found while linking Discord.</summary>
internal static class MergeEndpoints
{
    public sealed record KeptDto(string Timezone, int GraceDaysPerWeek);
    public sealed record MergePreviewDto(int Habits, int Logs, int DayMarks, IReadOnlyList<string> HabitNames, KeptDto Kept);

    public static RouteGroupBuilder MapMerge(this RouteGroupBuilder api)
    {
        api.MapGet("/account/merge", async (HttpContext http, UserManager<User> users, HabitService habits) =>
        {
            var user = await users.GetUserAsync(http.User);
            if (user is null) return Problems.Unauthenticated();

            if (PendingMerge.Read(http, user) is not { } pending
                || await habits.GetMergePreviewAsync(pending.SourceUserId, pending.DiscordId) is not { } preview)
                return Problems.NotFound();

            return Results.Ok(new MergePreviewDto(preview.Habits, preview.Logs, preview.DayMarks, preview.HabitNames,
                new KeptDto(user.Timezone, user.GraceDaysPerWeek)));
        });

        api.MapPost("/account/merge", async (HttpContext http, UserManager<User> users, SignInManager<User> signIn,
            HabitService habits, EmberDbContext db) =>
        {
            var user = await users.GetUserAsync(http.User);
            if (user is null) return Problems.Unauthenticated();
            if (!await habits.HasHealthDataConsentAsync(user.Id)) return Problems.ConsentRequired();
            if (PendingMerge.Read(http, user) is not { } pending) return Problems.NotFound();

            if (await habits.MergeBotOnlyAccountAsync(user.Id, pending.SourceUserId, pending.DiscordId) == AccountMergeResult.Conflict)
                return Problems.Conflict("This Discord account can no longer be merged into yours.");

            PendingMerge.Clear(http);
            db.ChangeTracker.Clear();
            if (await users.FindByIdAsync(user.Id.ToString()) is { } merged) await signIn.RefreshSignInAsync(merged);
            return Results.NoContent();
        });

        api.MapDelete("/account/merge", (HttpContext http) =>
        {
            PendingMerge.Clear(http);
            return Results.NoContent();
        });

        return api;
    }
}
