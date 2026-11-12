using System.Threading.RateLimiting;
using Ember.Core.Services;

namespace Ember.Api;

/// <summary>In-app feedback from the web and Android apps, signed in or not.</summary>
internal static class FeedbackEndpoints
{
    public sealed record FeedbackRequest(string? Text, string? Platform, string? Version);

    public const int MaxVersionLength = 32;

    /// <summary>
    /// <c>POST /api/feedback</c>: validates, rate-limits (<see cref="RateLimits.FeedbackKeys"/>) and stores the trimmed text with
    /// the platform, version and the signed-in user, if any. Unknown body members are ignored. 429 also when
    /// <see cref="HabitService.MaxFeedbackPerDay"/> were submitted in the last 24 hours on any platform.
    /// </summary>
    public static RouteGroupBuilder MapFeedback(this RouteGroupBuilder api)
    {
        api.MapPost("/feedback", async (FeedbackRequest request, HttpContext http, PartitionedRateLimiter<string> limiter, HabitService habits) =>
        {
            var text = request.Text?.Trim() ?? "";
            var errors = new Dictionary<string, string[]>();
            if (HabitService.FeedbackTextError(text) is { } textError) errors["text"] = [textError];
            if (request.Platform is not ("web" or "android")) errors["platform"] = ["Must be web or android."];
            if (request.Version is { } version && !IsVersion(version))
                errors["version"] = [$"1 to {MaxVersionLength} letters, digits or . + _ -"];
            if (errors.Count > 0) return Problems.Validation(errors);

            Guid? userId = http.User.Identity?.IsAuthenticated == true ? http.User.UserId() : null;
            foreach (var key in RateLimits.FeedbackKeys(userId, http.Connection.RemoteIpAddress))
            {
                using var lease = limiter.AttemptAcquire(key);
                if (!lease.IsAcquired) return RateLimits.Reject(http, lease, RateLimits.MailWindow);
            }

            if (!await habits.SaveFeedbackAsync(userId, request.Platform!, request.Version, text, http.RequestAborted))
            {
                http.Response.Headers.RetryAfter = "3600";
                return Problems.RateLimited();
            }

            return Results.NoContent();
        });

        return api;
    }

    private static bool IsVersion(string version)
        => version is { Length: > 0 and <= MaxVersionLength } && version.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '+' or '_' or '-');
}
