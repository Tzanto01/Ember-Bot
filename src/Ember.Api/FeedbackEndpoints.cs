using System.Threading.RateLimiting;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.Server.Kestrel.Core.Features;

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
    /// are ignored. A missing <c>title</c> (app versions before v1.15) is taken from the text's first line. 429 also when <see cref="HabitService.MaxFeedbackPerDay"/> were submitted or
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

    /// <summary>The server's request body limit, which every other request keeps.</summary>
    public const long SmallBodyBytes = 64 * 1024;

    /// <summary>Most requests over <see cref="SmallBodyBytes"/> to <c>POST /api/feedback</c> read at the same time, across all users.</summary>
    public const int MaxConcurrentBigBodies = 2;

    /// <summary>Slowest upload rate a request over <see cref="SmallBodyBytes"/> may keep (after a 10 s grace), so a slow upload can't hold a slot for long.</summary>
    public const double MinBigBodyBytesPerSecond = 50 * 1024;

    private static readonly SemaphoreSlim BigBodies = new(MaxConcurrentBigBodies);

    /// <summary>
    /// Middleware before the endpoints: for a signed-in caller's <c>POST /api/feedback</c> without a <c>Content-Length</c> or
    /// with one over <see cref="SmallBodyBytes"/>, takes one of <see cref="MaxConcurrentBigBodies"/> slots and then a
    /// <see cref="RateLimits.FeedbackBigBodyKey"/> permit before the body is read, then raises the body limit to
    /// <see cref="MaxBodyBytes"/> and requires at least <see cref="MinBigBodyBytesPerSecond"/>, so only signed-in callers can send pictures and they can't flood the server with large
    /// invalid bodies. Without a permit or slot it answers 429 (<c>Retry-After</c> from the lease, else 60 s for a slot).
    /// Everyone else, and small bodies, keep the server's limit.
    /// </summary>
    public static async Task RaiseBodyLimit(HttpContext http, RequestDelegate next)
    {
        if (!HttpMethods.IsPost(http.Request.Method)
            || http.User.Identity?.IsAuthenticated != true
            || !http.Request.Path.Equals("/api/feedback", StringComparison.OrdinalIgnoreCase)
            || http.Request.ContentLength <= SmallBodyBytes)
        {
            await next(http);
            return;
        }

        if (!BigBodies.Wait(0))
        {
            http.Response.Headers.RetryAfter = "60";
            await Problems.RateLimited().ExecuteAsync(http);
            return;
        }

        try
        {
            var limiter = http.RequestServices.GetRequiredService<PartitionedRateLimiter<string>>();
            using (var lease = limiter.AttemptAcquire(RateLimits.FeedbackBigBodyKey(http.User.UserId())))
            {
                if (!lease.IsAcquired)
                {
                    await RateLimits.Reject(http, lease, RateLimits.MailWindow).ExecuteAsync(http);
                    return;
                }
            }

            if (http.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit) limit.MaxRequestBodySize = MaxBodyBytes;
            if (http.Features.Get<IHttpMinRequestBodyDataRateFeature>() is { } rate)
                rate.MinDataRate = new MinDataRate(MinBigBodyBytesPerSecond, TimeSpan.FromSeconds(10));
            await next(http);
        }
        finally
        {
            BigBodies.Release();
        }
    }

    private static bool IsVersion(string version)
        => version is { Length: > 0 and <= MaxVersionLength } && version.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '+' or '_' or '-');
}
