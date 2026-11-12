using System.Globalization;
using System.Security.Claims;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;

namespace Ember.Api.TestHost;

/// <summary>The test host's <c>/test/*</c> endpoints (see README.md). Needs <see cref="TestFakes.AddEmberTestFakes"/>.</summary>
public static class TestEndpoints
{
    public sealed record OutboxDto(string To, string Subject, IReadOnlyList<string> Links);
    public sealed record BotOnlyRequest(string? DiscordId, string? HabitStartDate);
    public sealed record BotOnlyDto(Guid UserId, int HabitId);
    public sealed record TotpDto(string Code);
    public sealed record TargetsDto(bool Discord, IReadOnlyList<int> PushSubscriptionIds);
    public sealed record FeedbackDto(int Id, string Title, Guid? UserId, int PictureCount);

    public static WebApplication MapEmberTestEndpoints(this WebApplication app)
    {
        var test = app.MapGroup("/test");

        test.MapGet("/discord/next", (string? id, string? error, FakeDiscord discord) =>
        {
            if (error == "access_denied" && id is null)
                discord.DenyNext();
            else if (error is null && ulong.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out var discordId))
                discord.SetNext(discordId);
            else
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["id"] = ["Pass a Discord ID or error=access_denied."] });
            return Results.NoContent();
        });

        test.MapGet("/discord/authorize", ([FromQuery(Name = "redirect_uri")] string redirectUri, string state, FakeDiscord discord) =>
            Results.Redirect(QueryHelpers.AddQueryString(redirectUri, discord.TakeDeny()
                ? new Dictionary<string, string?> { ["error"] = "access_denied", ["state"] = state }
                : new Dictionary<string, string?> { ["code"] = "fake", ["state"] = state })));

        test.MapGet("/outbox", (string email, OutboxEmailTransport outbox) =>
            outbox.Latest(email) is { } latest
                ? Results.Ok(new OutboxDto(latest.To, latest.Subject, latest.Links))
                : Results.NotFound());

        test.MapGet("/users/totp", async (string email, UserManager<User> users) =>
            await users.FindByEmailAsync(email) is { } user && await users.GetAuthenticatorKeyAsync(user) is { } key
                ? Results.Ok(new TotpDto(Totp.Code(key)))
                : Results.NotFound());

        test.MapGet("/feedback/latest", async (EmberDbContext db) =>
            await db.Feedback.OrderByDescending(f => f.Id)
                .Select(f => new FeedbackDto(f.Id, f.Title, f.UserId, f.Images.Count))
                .FirstOrDefaultAsync() is { } latest
                ? Results.Ok(latest)
                : Results.NotFound());

        test.MapPost("/users/bot-only", async (BotOnlyRequest request, HabitService habits, EmberDbContext db, TimeProvider time) =>
        {
            if (!ulong.TryParse(request.DiscordId, NumberStyles.None, CultureInfo.InvariantCulture, out var discordId))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["discordId"] = ["Must be a Discord user ID."] });

            var now = time.GetUtcNow().UtcDateTime;
            var startDate = DateOnly.FromDateTime(now);
            if (request.HabitStartDate is not null
                && (!DateOnly.TryParseExact(request.HabitStartDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out startDate)
                    || startDate > DateOnly.FromDateTime(now)))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["habitStartDate"] = ["Must be a yyyy-MM-dd date, not in the future."] });

            if (await habits.FindDiscordUserAsync(discordId) != Guid.Empty)
                return Results.Conflict();

            var userId = await habits.ResolveOrCreateDiscordUserAsync(discordId);
            await habits.GiveHealthDataConsentAsync(userId);
            var habit = await habits.AddHabitAsync(userId, "Water", null);
            if (startDate < DateOnly.FromDateTime(now))
            {
                var createdAt = startDate.ToDateTime(new TimeOnly(12, 0), DateTimeKind.Utc);
                await db.Habits.Where(h => h.Id == habit.Id).ExecuteUpdateAsync(s => s.SetProperty(h => h.CreatedAt, createdAt));
            }
            return Results.Created((string?)null, new BotOnlyDto(userId, habit.Id));
        });

        test.MapGet("/reminders/targets", async (int? habitId, int? routineId, ClaimsPrincipal principal, UserManager<User> users,
            HabitService habits, EmberDbContext db) =>
        {
            if (habitId is null == routineId is null)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["habitId"] = ["Pass habitId or routineId."] });

            var userId = Guid.Parse(users.GetUserId(principal)!);
            var exclusions = habitId is { } id
                ? await db.Habits.Where(h => h.Id == id && h.UserId == userId).Select(h => h.ReminderExclusions).FirstOrDefaultAsync()
                : await db.Routines.Where(r => r.Id == routineId && r.UserId == userId).Select(r => r.ReminderExclusions).FirstOrDefaultAsync();
            if (exclusions is null || await habits.GetUserWithDestinationsAsync(userId) is not { } user) return Results.NotFound();

            var targets = ReminderDestinations.Resolve(user, exclusions);
            return Results.Ok(new TargetsDto(targets.Discord, targets.PushSubscriptionIds));
        }).RequireAuthorization();

        return app;
    }
}
