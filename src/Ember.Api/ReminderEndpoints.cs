using Ember.Core.Services;

namespace Ember.Api;

/// <summary>The anonymous "Done" action of a web push reminder, authorized by its one-time token alone.</summary>
internal static class ReminderEndpoints
{
    public const string DonePath = "/api/reminders/done";

    /// <summary>Longer than any token the bot issues (43 characters); longer input is unknown without hashing it.</summary>
    private const int MaxTokenLength = 128;

    public sealed record DoneRequest(string? Token);

    public static RouteGroupBuilder MapReminders(this RouteGroupBuilder api)
    {
        api.MapPost("/reminders/done", async (DoneRequest request, HabitService habits) =>
        {
            if (request.Token is not { Length: > 0 and <= MaxTokenLength } token) return Problems.NotFound();

            return await habits.UseReminderActionTokenAsync(token) switch
            {
                ReminderActionResult.Logged => Results.NoContent(),
                ReminderActionResult.Expired => Problems.Expired(),
                ReminderActionResult.ConsentRequired => Problems.ConsentRequired(),
                _ => Problems.NotFound(),
            };
        }).RequireRateLimiting(RateLimits.AuthPolicy);

        return api;
    }
}
