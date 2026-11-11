using System.Security.Claims;
using Ember.Core.Models;
using Microsoft.AspNetCore.Identity;

namespace Ember.Api;

/// <summary>
/// Two-factor sign-in (TOTP) of the signed-in account. Every endpoint that takes a code or the password is under the per-IP
/// credential limit, and a wrong code counts towards lockout like a wrong password.
/// </summary>
internal static class TwoFactorEndpoints
{
    public sealed record TwoFactorState(bool Enabled, int RecoveryCodesLeft);
    public sealed record SetupDto(string SharedKey, string AuthenticatorUri);
    public sealed record CodeRequest(string? Code);
    public sealed record EnableRequest(string? Code, string? Password);
    public sealed record DisableRequest(string? Password, string? Code);
    public sealed record RecoveryCodesDto(string[] RecoveryCodes);

    private const int RecoveryCodeCount = 10;
    private const string WrongCode = "The code is not correct.";

    public static RouteGroupBuilder MapTwoFactor(this RouteGroupBuilder api)
    {
        api.MapGet("/me/2fa", async (ClaimsPrincipal principal, UserManager<User> users) =>
            await users.GetUserAsync(principal) is { } user
                ? Results.Ok(new TwoFactorState(user.TwoFactorEnabled, await users.CountRecoveryCodesAsync(user)))
                : Problems.Unauthenticated());

        api.MapPost("/me/2fa/setup", async (ClaimsPrincipal principal, UserManager<User> users) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Problems.Unauthenticated();
            if (user.TwoFactorEnabled) return Problems.Conflict("Two-factor sign-in is already on.");

            await users.SetLockoutEnabledAsync(user, true);
            await users.ResetAuthenticatorKeyAsync(user);
            var key = (await users.GetAuthenticatorKeyAsync(user))!;
            var label = Uri.EscapeDataString("Ember:" + (user.Email ?? "Ember account"));
            return Results.Ok(new SetupDto(key, $"otpauth://totp/{label}?secret={key}&issuer=Ember&digits=6"));
        }).RequireRateLimiting(RateLimits.AuthPolicy);

        api.MapPost("/me/2fa/enable", async (EnableRequest request, ClaimsPrincipal principal, UserManager<User> users, SignInManager<User> signIn) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Problems.Unauthenticated();
            if (user.TwoFactorEnabled) return Problems.Conflict("Two-factor sign-in is already on.");
            if (await JournalEndpoints.PasswordProblem(user, request.Password, users, signIn) is { } passwordProblem) return passwordProblem;
            if (await users.GetAuthenticatorKeyAsync(user) is null || !await CheckCodeAsync(users, user, request.Code))
                return Problems.Validation("code", WrongCode);

            await users.SetTwoFactorEnabledAsync(user, true);
            var codes = await users.GenerateNewTwoFactorRecoveryCodesAsync(user, RecoveryCodeCount);
            await signIn.RefreshSignInAsync(user);
            return Results.Ok(new RecoveryCodesDto(codes!.ToArray()));
        }).RequireRateLimiting(RateLimits.AuthPolicy);

        api.MapPost("/me/2fa/disable", async (DisableRequest request, ClaimsPrincipal principal, UserManager<User> users, SignInManager<User> signIn) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Problems.Unauthenticated();

            if (await users.HasPasswordAsync(user))
            {
                if (!(await signIn.CheckPasswordSignInAsync(user, request.Password ?? "", lockoutOnFailure: true)).Succeeded)
                    return Problems.Validation("password", "The password is not correct.");
            }
            else if (user.TwoFactorEnabled && !await CheckCodeAsync(users, user, request.Code))
            {
                return Problems.Validation("code", WrongCode);
            }

            await users.SetTwoFactorEnabledAsync(user, false);
            await users.ResetAuthenticatorKeyAsync(user);
            await users.GenerateNewTwoFactorRecoveryCodesAsync(user, 0);
            await signIn.RefreshSignInAsync(user);
            return Results.NoContent();
        }).RequireRateLimiting(RateLimits.AuthPolicy);

        api.MapPost("/me/2fa/recovery-codes", async (CodeRequest request, ClaimsPrincipal principal, UserManager<User> users, SignInManager<User> signIn) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Problems.Unauthenticated();
            if (!user.TwoFactorEnabled) return Problems.Conflict("Two-factor sign-in is off.");
            if (!await CheckCodeAsync(users, user, request.Code)) return Problems.Validation("code", WrongCode);

            var codes = await users.GenerateNewTwoFactorRecoveryCodesAsync(user, RecoveryCodeCount);
            await signIn.RefreshSignInAsync(user);
            return Results.Ok(new RecoveryCodesDto(codes!.ToArray()));
        }).RequireRateLimiting(RateLimits.AuthPolicy);

        return api;
    }

    /// <summary>
    /// Whether <paramref name="code"/> is the account's current authenticator code. A locked-out account never passes; a wrong
    /// code counts towards lockout, a right one resets the count.
    /// </summary>
    internal static async Task<bool> CheckCodeAsync(UserManager<User> users, User user, string? code)
    {
        if (await users.IsLockedOutAsync(user)) return false;
        if (code is { Length: > 0 } && await users.VerifyTwoFactorTokenAsync(user, users.Options.Tokens.AuthenticatorTokenProvider, code))
        {
            await users.ResetAccessFailedCountAsync(user);
            return true;
        }

        await users.AccessFailedAsync(user);
        return false;
    }
}
