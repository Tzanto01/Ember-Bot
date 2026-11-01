using System.Security.Claims;

namespace Ember.Api;

internal static class CurrentUser
{
    /// <summary>The signed-in user's Ember ID. Only for endpoints that require authorization.</summary>
    public static Guid UserId(this ClaimsPrincipal principal)
        => Guid.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new InvalidOperationException("The request has no signed-in user."));
}
