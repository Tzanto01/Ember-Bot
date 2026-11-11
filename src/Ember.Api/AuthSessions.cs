using System.Security.Claims;
using Ember.Core.Data;
using Ember.Core.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Ember.Api;

/// <summary>
/// Server-side sign-in sessions (<see cref="AuthSession"/>). Every sign-in starts one and carries its ID in the
/// <see cref="ClaimType"/> claim of the cookie and of the bearer access and refresh tokens. A cookie or token is accepted only
/// while its session exists and hasn't expired; one without the claim is never accepted. Lookups are cached for up to
/// <see cref="CacheFor"/>; ending a session drops the cached entry at once, and a lookup that read the session before it ended
/// doesn't cache it. A user keeps at most <see cref="MaxPerUser"/> sessions; a new one ends the oldest.
/// </summary>
internal sealed class AuthSessions(EmberDbContext db, IMemoryCache cache, TimeProvider time)
{
    public const string ClaimType = "ember:sid";

    /// <summary>Matches the cookie and refresh-token lifetime; slides forward while the session is in use.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(14);

    private static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan TouchEvery = TimeSpan.FromMinutes(5);
    private const int MaxPerUser = 50;

    private sealed record Entry(Guid UserId, DateTimeOffset ExpiresUtc);

    /// <summary>The session ID in <paramref name="principal"/>, or null.</summary>
    public static Guid? IdOf(ClaimsPrincipal? principal)
        => Guid.TryParse(principal?.FindFirstValue(ClaimType), out var id) ? id : null;

    /// <summary>Starts a session for <paramref name="userId"/>, ending its oldest beyond <see cref="MaxPerUser"/>, and deletes every expired session.</summary>
    public async Task<Guid> StartAsync(Guid userId)
    {
        var now = time.GetUtcNow();
        await db.AuthSessions.Where(s => s.ExpiresUtc <= now).ExecuteDeleteAsync();
        await EndManyAsync(await db.AuthSessions.Where(s => s.UserId == userId).OrderByDescending(s => s.CreatedUtc)
            .Skip(MaxPerUser - 1).Select(s => s.Id).ToListAsync());
        var id = Guid.NewGuid();
        db.AuthSessions.Add(new AuthSession { Id = id, UserId = userId, CreatedUtc = now, ExpiresUtc = now + Lifetime, LastSeenUtc = now });
        await db.SaveChangesAsync();
        return id;
    }

    /// <summary>Whether <paramref name="principal"/> carries a live session of its own user; extends the session while in use.</summary>
    public async Task<bool> IsActiveAsync(ClaimsPrincipal principal)
    {
        if (IdOf(principal) is not { } id || !Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return false;

        var now = time.GetUtcNow();
        if (!cache.TryGetValue(Key(id), out Entry? entry))
        {
            var row = await db.AuthSessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id);
            if (row is not null && row.ExpiresUtc > now && (row.LastSeenUtc is not { } seen || now - seen >= TouchEvery))
            {
                var expires = now + Lifetime;
                var touched = await db.AuthSessions.Where(s => s.Id == id)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.ExpiresUtc, expires).SetProperty(x => x.LastSeenUtc, now));
                if (touched == 0) row = null;
                else row.ExpiresUtc = expires;
            }
            entry = row is null ? null : new Entry(row.UserId, row.ExpiresUtc);
            cache.Set(Key(id), entry, CacheFor);
            if (cache.TryGetValue(EndedKey(id), out _))
            {
                cache.Remove(Key(id));
                return false;
            }
        }
        return entry is not null && entry.UserId == userId && entry.ExpiresUtc > now;
    }

    public Task EndAsync(Guid id) => EndManyAsync([id]);

    /// <summary>Ends every session of <paramref name="userId"/>, except <paramref name="keep"/>.</summary>
    public async Task EndAllAsync(Guid userId, Guid? keep = null)
        => await EndManyAsync(await db.AuthSessions.Where(s => s.UserId == userId && s.Id != keep).Select(s => s.Id).ToListAsync());

    /// <summary>Deletes the sessions and marks them ended for <see cref="CacheFor"/>, so a lookup already past its read drops them.</summary>
    private async Task EndManyAsync(List<Guid> ids)
    {
        if (ids.Count == 0) return;
        await db.AuthSessions.Where(s => ids.Contains(s.Id)).ExecuteDeleteAsync();
        foreach (var id in ids)
        {
            cache.Set(EndedKey(id), true, CacheFor);
            cache.Remove(Key(id));
        }
    }

    /// <summary>
    /// Middleware after authentication: a bearer access token whose session has ended leaves the request anonymous.
    /// Cookies are checked in the cookie's <c>OnValidatePrincipal</c> (<see cref="ValidateCookie"/>).
    /// </summary>
    public static async Task RejectEndedBearer(HttpContext http, RequestDelegate next)
    {
        if (http.User.Identity?.IsAuthenticated == true
            && (await http.AuthenticateAsync(IdentityConstants.BearerScheme)).Succeeded
            && !await http.RequestServices.GetRequiredService<AuthSessions>().IsActiveAsync(http.User))
            http.User = new ClaimsPrincipal(new ClaimsIdentity());
        await next(http);
    }

    /// <summary>Rejects and deletes a cookie whose session has ended, then runs the security stamp check.</summary>
    public static Func<CookieValidatePrincipalContext, Task> ValidateCookie(Func<CookieValidatePrincipalContext, Task> stampCheck)
        => async context =>
        {
            if (context.Principal is null || !await context.HttpContext.RequestServices.GetRequiredService<AuthSessions>().IsActiveAsync(context.Principal))
            {
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
                return;
            }
            await stampCheck(context);
        };

    private static string Key(Guid id) => "auth-session:" + id;

    private static string EndedKey(Guid id) => "auth-session-ended:" + id;
}
