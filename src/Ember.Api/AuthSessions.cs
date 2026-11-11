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
/// <see cref="CacheFor"/>; ending a session drops the cached entry at once.
/// </summary>
internal sealed class AuthSessions(EmberDbContext db, IMemoryCache cache, TimeProvider time)
{
    public const string ClaimType = "ember:sid";

    /// <summary>Matches the cookie and refresh-token lifetime; slides forward while the session is in use.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(14);

    private static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan TouchEvery = TimeSpan.FromMinutes(5);

    private sealed record Entry(Guid UserId, DateTimeOffset ExpiresUtc);

    /// <summary>The session ID in <paramref name="principal"/>, or null.</summary>
    public static Guid? IdOf(ClaimsPrincipal? principal)
        => Guid.TryParse(principal?.FindFirstValue(ClaimType), out var id) ? id : null;

    /// <summary>Starts a session for <paramref name="userId"/> and deletes every expired session.</summary>
    public async Task<Guid> StartAsync(Guid userId)
    {
        var now = time.GetUtcNow();
        await db.AuthSessions.Where(s => s.ExpiresUtc <= now).ExecuteDeleteAsync();
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
                row.ExpiresUtc = now + Lifetime;
                await db.AuthSessions.Where(s => s.Id == id)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.ExpiresUtc, row.ExpiresUtc).SetProperty(x => x.LastSeenUtc, now));
            }
            entry = row is null ? null : new Entry(row.UserId, row.ExpiresUtc);
            cache.Set(Key(id), entry, CacheFor);
        }
        return entry is not null && entry.UserId == userId && entry.ExpiresUtc > now;
    }

    public async Task EndAsync(Guid id)
    {
        await db.AuthSessions.Where(s => s.Id == id).ExecuteDeleteAsync();
        cache.Remove(Key(id));
    }

    /// <summary>Ends every session of <paramref name="userId"/>, except <paramref name="keep"/>.</summary>
    public async Task EndAllAsync(Guid userId, Guid? keep = null)
    {
        var ids = await db.AuthSessions.Where(s => s.UserId == userId && s.Id != keep).Select(s => s.Id).ToListAsync();
        await db.AuthSessions.Where(s => ids.Contains(s.Id)).ExecuteDeleteAsync();
        foreach (var id in ids) cache.Remove(Key(id));
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
}
