using System.Threading.RateLimiting;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.AspNetCore.Http.Features;

namespace Ember.Api;

/// <summary>In-app feedback from the web and Android apps, signed in or not.</summary>
internal static class FeedbackEndpoints
{
    public sealed record FeedbackRequest(string? Title, string? Text, string? Platform, string? Version, string?[]? Images = null, bool? Anonymous = null);

    public const int MaxVersionLength = 32;

    /// <summary>Request body limit of <c>POST /api/feedback</c> for a signed-in caller: the pictures in base64 plus the text.</summary>
    public const long MaxBodyBytes = 14L * 1024 * 1024;

    /// <summary>
    /// <c>POST /api/feedback</c>: validates, rate-limits (<see cref="RateLimits.FeedbackKeys"/>) and stores the trimmed title and
    /// text with the platform, version and the signed-in user unless <c>anonymous</c> is true. <c>images</c> (base64, signed-in
    /// callers only, anonymous or not) are checked cheaply before the rate limit, then decoded and stripped by
    /// <see cref="FeedbackImages.Sanitize"/> and counted against <see cref="RateLimits.FeedbackBytesKey"/>. Unknown body members
    /// are ignored. A missing <c>title</c> (app versions before v1.14) is taken from the text's first line. 429 also when <see cref="HabitService.MaxFeedbackPerDay"/> were submitted or
    /// <see cref="HabitService.MaxFeedbackImageBytesPerDay"/> stored in the last 24 hours on any platform.
    /// </summary>
    public static RouteGroupBuilder MapFeedback(this RouteGroupBuilder api)
    {
        api.MapPost("/feedback", async (FeedbackRequest request, HttpContext http, PartitionedRateLimiter<string> limiter, HabitService habits) =>
        {
            var title = request.Title?.Trim();
            var text = request.Text?.Trim() ?? "";
            var images = request.Images ?? [];
            Guid? userId = http.User.Identity?.IsAuthenticated == true ? http.User.UserId() : null;
            var errors = new Dictionary<string, string[]>();
            if (title is not null && HabitService.FeedbackTitleError(title) is { } titleError) errors["title"] = [titleError];
            if (HabitService.FeedbackTextError(text) is { } textError) errors["text"] = [textError];
            if (request.Platform is not ("web" or "android")) errors["platform"] = ["Must be web or android."];
            if (request.Version is { } version && !IsVersion(version))
                errors["version"] = [$"1 to {MaxVersionLength} letters, digits or . + _ -"];
            if (images.Length > 0 && FeedbackImages.RequestError(images, userId is not null) is { } imagesError) errors["images"] = [imagesError];
            if (errors.Count > 0) return Problems.Validation(errors);

            foreach (var key in RateLimits.FeedbackKeys(userId, http.Connection.RemoteIpAddress))
            {
                using var lease = limiter.AttemptAcquire(key);
                if (!lease.IsAcquired) return RateLimits.Reject(http, lease, RateLimits.MailWindow);
            }

            var stored = new List<FeedbackImage>(images.Length);
            var decodedBytes = 0;
            foreach (var image in images)
            {
                if (FeedbackImages.Decode(image!) is not { } decoded) return Problems.Validation("images", FeedbackImages.Unreadable);
                if (FeedbackImages.Sanitize(decoded, out var imageError) is not { } sanitized) return Problems.Validation("images", imageError!);
                stored.Add(sanitized);
                decodedBytes += decoded.Length;
            }

            if (stored.Count > 0)
            {
                using var lease = limiter.AttemptAcquire(RateLimits.FeedbackBytesKey(userId!.Value), decodedBytes);
                if (!lease.IsAcquired) return RateLimits.Reject(http, lease, TimeSpan.FromDays(1));
            }

            if (!await habits.SaveFeedbackAsync(request.Anonymous == true ? null : userId, request.Platform!, request.Version, text,
                    http.RequestAborted, title, stored))
            {
                http.Response.Headers.RetryAfter = "3600";
                return Problems.RateLimited();
            }

            return Results.NoContent();
        });

        return api;
    }

    /// <summary>
    /// Middleware before the endpoints: raises the body limit of <c>POST /api/feedback</c> to <see cref="MaxBodyBytes"/> for a
    /// signed-in caller, so only they can send pictures; everyone else keeps the server's 64 KiB.
    /// </summary>
    public static Task RaiseBodyLimit(HttpContext http, RequestDelegate next)
    {
        if (HttpMethods.IsPost(http.Request.Method)
            && http.User.Identity?.IsAuthenticated == true
            && http.Request.Path.Equals("/api/feedback", StringComparison.OrdinalIgnoreCase)
            && http.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
            limit.MaxRequestBodySize = MaxBodyBytes;
        return next(http);
    }

    private static bool IsVersion(string version)
        => version is { Length: > 0 and <= MaxVersionLength } && version.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '+' or '_' or '-');
}
