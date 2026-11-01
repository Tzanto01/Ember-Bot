namespace Ember.Api;

/// <summary>Web push: 501 until the Phase 6 push slice lands (the web app hides push settings on 501).</summary>
internal static class PushEndpoints
{
    public static RouteGroupBuilder MapPush(this RouteGroupBuilder api)
    {
        api.MapGet("/push/vapid-public-key", () => Results.StatusCode(StatusCodes.Status501NotImplemented));
        api.MapPost("/me/push-subscriptions", () => Results.StatusCode(StatusCodes.Status501NotImplemented)).RequireAuthorization();
        api.MapDelete("/me/push-subscriptions", () => Results.StatusCode(StatusCodes.Status501NotImplemented)).RequireAuthorization();
        return api;
    }
}
