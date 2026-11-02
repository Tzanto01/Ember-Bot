using System.Security.Claims;
using Ember.Core.Services;

namespace Ember.Api;

/// <summary>Web push: the VAPID public key and the signed-in user's browser subscriptions.</summary>
internal static class PushEndpoints
{
    public sealed record VapidKeyDto(string Key);
    public sealed record PushKeysRequest(string? P256dh, string? Auth);
    public sealed record PushSubscriptionRequest(string? Endpoint, PushKeysRequest? Keys);

    public const int MaxEndpointLength = 2048;
    public const int MaxP256dhLength = 256;
    public const int MaxAuthLength = 64;

    private static readonly string[] ExactHosts =
        ["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];

    private static readonly string[] HostSuffixes = ["push.services.mozilla.com", "notify.windows.com", "push.apple.com"];

    private const string EndpointMessage = "Must be an https URL of a known push service.";

    public static RouteGroupBuilder MapPush(this RouteGroupBuilder api)
    {
        api.MapGet("/push/vapid-public-key", (IConfiguration config) =>
            string.IsNullOrWhiteSpace(config["WebPush:PublicKey"])
                ? Results.StatusCode(StatusCodes.Status501NotImplemented)
                : Results.Ok(new VapidKeyDto(config["WebPush:PublicKey"]!)));

        api.MapPost("/me/push-subscriptions", async (PushSubscriptionRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (!IsAllowedEndpoint(request.Endpoint)) errors["endpoint"] = [EndpointMessage];
            if (!IsBase64Url(request.Keys?.P256dh, MaxP256dhLength))
                errors["keys.p256dh"] = [$"Must be base64url, at most {MaxP256dhLength} characters."];
            if (!IsBase64Url(request.Keys?.Auth, MaxAuthLength))
                errors["keys.auth"] = [$"Must be base64url, at most {MaxAuthLength} characters."];
            if (errors.Count > 0) return Problems.Validation(errors);

            await habits.SavePushSubscriptionAsync(principal.UserId(), request.Endpoint!, request.Keys!.P256dh!, request.Keys.Auth!);
            return Results.NoContent();
        }).RequireAuthorization();

        api.MapDelete("/me/push-subscriptions", async (string? endpoint, ClaimsPrincipal principal, HabitService habits) =>
        {
            if (string.IsNullOrEmpty(endpoint)) return Problems.Validation("endpoint", "Required.");

            await habits.DeletePushSubscriptionAsync(principal.UserId(), endpoint);
            return Results.NoContent();
        }).RequireAuthorization();

        return api;
    }

    /// <summary>
    /// Whether <paramref name="endpoint"/> is an absolute https URL on the default port, without user info, whose ASCII DNS host
    /// is one of <see cref="ExactHosts"/> or a subdomain (dot boundary) of one of <see cref="HostSuffixes"/>, compared case-insensitively.
    /// </summary>
    internal static bool IsAllowedEndpoint(string? endpoint)
    {
        if (endpoint is not { Length: > 0 and <= MaxEndpointLength }
            || endpoint.Any(c => char.IsWhiteSpace(c) || char.IsControl(c) || !char.IsAscii(c))
            || !endpoint.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            || endpoint["https://".Length..].Split('/', '?', '#', '\\')[0].Contains('@')
            || !Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !uri.IsDefaultPort
            || uri.UserInfo.Length > 0
            || uri.HostNameType != UriHostNameType.Dns)
            return false;

        var host = uri.Host;
        return ExactHosts.Any(h => host.Equals(h, StringComparison.OrdinalIgnoreCase))
            || HostSuffixes.Any(s => host.EndsWith("." + s, StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsBase64Url(string? value, int maxLength)
    {
        if (value is not { Length: > 0 } || value.Length > maxLength) return false;
        var data = value.TrimEnd('=');
        return data.Length > 0 && value.Length - data.Length <= 2
            && data.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    }
}
