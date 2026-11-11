using System.Security.Claims;
using Ember.Core.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace Ember.Api;

/// <summary>
/// Password sign-in that reveals nothing about an account until the password matched: an unknown user or an account without
/// a password (bot-only, created through Discord) costs one password hash check and fails like a wrong password, and
/// <see cref="SignInResult.NotAllowed"/> is only reported for the right password. A locked-out account fails like a wrong
/// password without checking it, so lockout neither confirms a guess nor reveals the account. A wrong password counts
/// towards lockout as in Identity but always reports <see cref="SignInResult.Failed"/>.
/// Two-factor: <see cref="SignInResult.TwoFactorRequired"/> only follows the right password, which doesn't reset the failure
/// count, so wrong passwords and wrong codes (authenticator or recovery) add up towards lockout; a locked-out account reports
/// <see cref="SignInResult.Failed"/> there too. A browser is never remembered, so every sign-in needs the code.
/// Sessions (<see cref="AuthSessions"/>): every sign-in starts one; a refresh of the cookie (after a security stamp change) or of
/// a bearer token keeps the session it came from. A new cookie sign-in ends the session of the cookie it replaces. A security
/// stamp change followed by <see cref="RefreshSignInAsync"/> ends every other session of the user.
/// </summary>
internal sealed class EmberSignInManager(
    UserManager<User> userManager,
    IHttpContextAccessor contextAccessor,
    IUserClaimsPrincipalFactory<User> claimsFactory,
    IOptions<IdentityOptions> optionsAccessor,
    ILogger<SignInManager<User>> logger,
    IAuthenticationSchemeProvider schemes,
    IUserConfirmation<User> confirmation,
    AuthSessions sessions)
    : SignInManager<User>(userManager, contextAccessor, claimsFactory, optionsAccessor, logger, schemes, confirmation)
{
    private static string? dummyHash;

    private string? carriedSession;
    private string? refreshedSession;

    public override async Task SignInWithClaimsAsync(User user, AuthenticationProperties? authenticationProperties, IEnumerable<Claim> additionalClaims)
    {
        if (refreshedSession is null && AuthenticationScheme == IdentityConstants.ApplicationScheme
            && AuthSessions.IdOf((await Context.AuthenticateAsync(IdentityConstants.ApplicationScheme)).Principal) is { } replaced)
            await sessions.EndAsync(replaced);

        var session = refreshedSession ?? (await sessions.StartAsync(user.Id)).ToString();
        carriedSession = null;
        await base.SignInWithClaimsAsync(user, authenticationProperties, [.. additionalClaims, new Claim(AuthSessions.ClaimType, session)]);
    }

    public override async Task RefreshSignInAsync(User user)
    {
        var current = UserManager.GetUserId(Context.User) == user.Id.ToString() ? AuthSessions.IdOf(Context.User) : null;
        if (Context.User.FindFirstValue(Options.ClaimsIdentity.SecurityStampClaimType) != user.SecurityStamp)
            await sessions.EndAllAsync(user.Id, keep: current);

        refreshedSession = current?.ToString();
        try
        {
            await base.RefreshSignInAsync(user);
        }
        finally
        {
            refreshedSession = null;
        }
    }

    /// <summary>
    /// Accepts a principal whose session is live, whatever its security stamp: every stamp change that signs devices out ends
    /// their sessions, so the device that made the change (cookie or bearer) keeps working. The session carries over to the
    /// next <see cref="CreateUserPrincipalAsync"/>.
    /// </summary>
    public override async Task<User?> ValidateSecurityStampAsync(ClaimsPrincipal? principal)
    {
        carriedSession = null;
        if (principal is null || !await sessions.IsActiveAsync(principal)) return null;
        var user = await UserManager.GetUserAsync(principal);
        if (user is not null) carriedSession = principal.FindFirstValue(AuthSessions.ClaimType);
        return user;
    }

    public override async Task<ClaimsPrincipal> CreateUserPrincipalAsync(User user)
    {
        var principal = await base.CreateUserPrincipalAsync(user);
        if (carriedSession is { } session)
        {
            carriedSession = null;
            ((ClaimsIdentity)principal.Identity!).AddClaim(new Claim(AuthSessions.ClaimType, session));
        }
        return principal;
    }

    public override async Task<SignInResult> PasswordSignInAsync(string userName, string password, bool isPersistent, bool lockoutOnFailure)
    {
        var user = await UserManager.FindByNameAsync(userName);
        if (user is not null) return await PasswordSignInAsync(user, password, isPersistent, lockoutOnFailure);

        VerifyDummy(password);
        return SignInResult.Failed;
    }

    public override async Task<SignInResult> CheckPasswordSignInAsync(User user, string password, bool lockoutOnFailure)
    {
        if (user.PasswordHash is null)
        {
            VerifyDummy(password);
            return SignInResult.Failed;
        }

        if (UserManager.SupportsUserLockout && await UserManager.IsLockedOutAsync(user))
        {
            VerifyDummy(password);
            return SignInResult.Failed;
        }

        if (!await UserManager.CheckPasswordAsync(user, password))
        {
            if (lockoutOnFailure && UserManager.SupportsUserLockout)
                await UserManager.AccessFailedAsync(user);
            return SignInResult.Failed;
        }

        if (!await CanSignInAsync(user)) return SignInResult.NotAllowed;

        if (UserManager.SupportsUserLockout && !await IsTwoFactorEnabledAsync(user)) await UserManager.ResetAccessFailedCountAsync(user);
        return SignInResult.Success;
    }

    public override async Task<SignInResult> TwoFactorAuthenticatorSignInAsync(string code, bool isPersistent, bool rememberClient)
    {
        var result = await base.TwoFactorAuthenticatorSignInAsync(code, isPersistent, rememberClient);
        return result.IsLockedOut ? SignInResult.Failed : result;
    }

    public override async Task<SignInResult> TwoFactorRecoveryCodeSignInAsync(string recoveryCode)
    {
        var user = await GetTwoFactorAuthenticationUserAsync();
        if (user is null || (UserManager.SupportsUserLockout && await UserManager.IsLockedOutAsync(user))) return SignInResult.Failed;

        var result = await base.TwoFactorRecoveryCodeSignInAsync(recoveryCode);
        if (!result.Succeeded && UserManager.SupportsUserLockout) await UserManager.AccessFailedAsync(user);
        return result.Succeeded ? result : SignInResult.Failed;
    }

    public override Task<bool> IsTwoFactorClientRememberedAsync(User user) => Task.FromResult(false);

    public override Task RememberTwoFactorClientAsync(User user) => Task.CompletedTask;

    /// <summary>Costs one password hash check against a throwaway hash, so a path without an account takes as long as one with.</summary>
    internal void VerifyDummy(string password)
    {
        var hasher = UserManager.PasswordHasher;
        dummyHash ??= hasher.HashPassword(new User(), Guid.NewGuid().ToString());
        hasher.VerifyHashedPassword(new User(), dummyHash, password ?? "");
    }
}
