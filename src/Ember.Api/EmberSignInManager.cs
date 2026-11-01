using Ember.Core.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace Ember.Api;

/// <summary>
/// Password sign-in that reveals nothing about an account until the password matched: an unknown user or an account without
/// a password (bot-only, created through Discord) costs one password hash check and fails like a wrong password, and
/// <see cref="SignInResult.NotAllowed"/> or <see cref="SignInResult.LockedOut"/> is only reported for the right password.
/// A wrong password counts towards lockout as in Identity (not while already locked out) but always reports <see cref="SignInResult.Failed"/>.
/// </summary>
internal sealed class EmberSignInManager(
    UserManager<User> userManager,
    IHttpContextAccessor contextAccessor,
    IUserClaimsPrincipalFactory<User> claimsFactory,
    IOptions<IdentityOptions> optionsAccessor,
    ILogger<SignInManager<User>> logger,
    IAuthenticationSchemeProvider schemes,
    IUserConfirmation<User> confirmation)
    : SignInManager<User>(userManager, contextAccessor, claimsFactory, optionsAccessor, logger, schemes, confirmation)
{
    private static string? dummyHash;

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

        var lockedOut = UserManager.SupportsUserLockout && await UserManager.IsLockedOutAsync(user);
        if (!await UserManager.CheckPasswordAsync(user, password))
        {
            if (lockoutOnFailure && UserManager.SupportsUserLockout && !lockedOut)
                await UserManager.AccessFailedAsync(user);
            return SignInResult.Failed;
        }

        if (!await CanSignInAsync(user)) return SignInResult.NotAllowed;
        if (lockedOut) return SignInResult.LockedOut;

        if (UserManager.SupportsUserLockout) await UserManager.ResetAccessFailedCountAsync(user);
        return SignInResult.Success;
    }

    private void VerifyDummy(string password)
    {
        var hasher = UserManager.PasswordHasher;
        dummyHash ??= hasher.HashPassword(new User(), Guid.NewGuid().ToString());
        hasher.VerifyHashedPassword(new User(), dummyHash, password ?? "");
    }
}
