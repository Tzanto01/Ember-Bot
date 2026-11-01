using System.Security.Cryptography;
using System.Text.Json;
using Ember.Core.Models;
using Microsoft.AspNetCore.DataProtection;

namespace Ember.Api;

/// <summary>
/// A Discord link that found a bot-only account, waiting for the user to confirm the merge. Stored in a data-protected,
/// HttpOnly cookie, valid for 15 minutes and only for the user who started it while their security stamp is unchanged
/// (the merge changes it, which makes the cookie single use).
/// </summary>
internal sealed record PendingMerge(Guid TargetUserId, string TargetSecurityStamp, Guid SourceUserId, ulong DiscordId, DateTimeOffset ExpiresUtc)
{
    /// <summary>The cookie's name outside Development, where it is always Secure.</summary>
    public const string SecureCookieName = "__Secure-ember.merge";

    /// <summary>The cookie's name in Development.</summary>
    public const string DevelopmentCookieName = "ember.merge";

    private const string Purpose = "Ember.Api.PendingMerge";
    private const string CookiePath = "/api/account/merge";
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

    public static void Store(HttpContext http, User target, Guid sourceUserId, ulong discordId)
    {
        var expires = http.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow() + Lifetime;
        var pending = new PendingMerge(target.Id, target.SecurityStamp ?? "", sourceUserId, discordId, expires);
        http.Response.Cookies.Append(CookieName(http), Protector(http).Protect(JsonSerializer.Serialize(pending)), Options(http, Lifetime));
    }

    /// <summary>The pending merge of <paramref name="user"/>, or null when there is none or it is expired, tampered or someone else's.</summary>
    public static PendingMerge? Read(HttpContext http, User user)
    {
        if (!http.Request.Cookies.TryGetValue(CookieName(http), out var value) || string.IsNullOrEmpty(value)) return null;

        PendingMerge? pending;
        try
        {
            pending = JsonSerializer.Deserialize<PendingMerge>(Protector(http).Unprotect(value));
        }
        catch (Exception e) when (e is CryptographicException or JsonException)
        {
            return null;
        }

        var now = http.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow();
        return pending is not null
            && pending.TargetUserId == user.Id
            && user.SecurityStamp is { Length: > 0 } stamp && pending.TargetSecurityStamp == stamp
            && pending.ExpiresUtc > now
                ? pending
                : null;
    }

    public static void Clear(HttpContext http) => http.Response.Cookies.Delete(CookieName(http), Options(http, null));

    private static bool IsDevelopment(HttpContext http) => http.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment();

    private static string CookieName(HttpContext http) => IsDevelopment(http) ? DevelopmentCookieName : SecureCookieName;

    private static IDataProtector Protector(HttpContext http)
        => http.RequestServices.GetRequiredService<IDataProtectionProvider>().CreateProtector(Purpose);

    private static CookieOptions Options(HttpContext http, TimeSpan? maxAge) => new()
    {
        HttpOnly = true,
        SameSite = SameSiteMode.Lax,
        Secure = http.Request.IsHttps || !IsDevelopment(http),
        Path = CookiePath,
        MaxAge = maxAge,
        IsEssential = true,
    };
}
