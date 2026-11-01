using System.Globalization;
using Ember.Core.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;

namespace Ember.Api.TestHost;

/// <summary>The test host's <c>/test/*</c> endpoints (see README.md). Needs <see cref="TestFakes.AddEmberTestFakes"/>.</summary>
public static class TestEndpoints
{
    public sealed record OutboxDto(string To, string Subject, IReadOnlyList<string> Links);
    public sealed record BotOnlyRequest(string? DiscordId);
    public sealed record BotOnlyDto(Guid UserId, int HabitId);

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

        test.MapPost("/users/bot-only", async (BotOnlyRequest request, HabitService habits) =>
        {
            if (!ulong.TryParse(request.DiscordId, NumberStyles.None, CultureInfo.InvariantCulture, out var discordId))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["discordId"] = ["Must be a Discord user ID."] });
            if (await habits.FindDiscordUserAsync(discordId) != Guid.Empty)
                return Results.Conflict();

            var userId = await habits.ResolveOrCreateDiscordUserAsync(discordId);
            await habits.GiveHealthDataConsentAsync(userId);
            var habit = await habits.AddHabitAsync(userId, "Water", null);
            return Results.Created((string?)null, new BotOnlyDto(userId, habit.Id));
        });

        return app;
    }
}
