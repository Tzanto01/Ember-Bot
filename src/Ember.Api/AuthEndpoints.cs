using System.Text;
using System.Threading.RateLimiting;
using Ember.Api.Email;
using Ember.Core.Models;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.Data;
using Microsoft.AspNetCore.WebUtilities;

namespace Ember.Api;

/// <summary>Identity's API endpoints with Ember's deviations, plus antiforgery and logout.</summary>
internal static class AuthEndpoints
{
    public const string XsrfCookieName = "XSRF-TOKEN";

    private static readonly PathString Register = "/api/auth/register";
    private static readonly PathString ConfirmEmail = "/api/auth/confirmEmail";
    private static readonly PathString ForgotPassword = "/api/auth/forgotPassword";
    private static readonly PathString ResetPassword = "/api/auth/resetPassword";
    private static readonly PathString Manage = "/api/auth/manage";

    private static readonly PathString[] AntiforgeryExempt =
    [
        Register, "/api/auth/login", "/api/auth/refresh", "/api/auth/resendConfirmationEmail",
        ForgotPassword, ResetPassword, ConfirmEmail,
    ];

    public sealed record ConfirmEmailRequest(string? UserId, string? Code, string? Password);

    public static RouteGroupBuilder MapAuth(this RouteGroupBuilder auth)
    {
        auth.MapIdentityApi<User>().AddEndpointFilter(IdentityFilter);

        auth.MapPost("/confirmEmail", async (ConfirmEmailRequest request, UserManager<User> users, SignInManager<User> signIn) =>
        {
            var user = Guid.TryParse(request.UserId, out var userId) ? await users.FindByIdAsync(userId.ToString()) : null;
            if (user is null)
            {
                ((EmberSignInManager)signIn).VerifyDummy(request.Password ?? "");
                return Problems.Unauthenticated();
            }

            var check = await signIn.CheckPasswordSignInAsync(user, request.Password ?? "", lockoutOnFailure: true);
            if (!check.Succeeded && !check.IsNotAllowed) return Problems.Unauthenticated();

            if (DecodeCode(request.Code) is not { } code || !(await users.ConfirmEmailAsync(user, code)).Succeeded)
            {
                await users.AccessFailedAsync(user);
                return Problems.Unauthenticated();
            }

            await users.ResetAccessFailedCountAsync(user);
            return Results.Ok();
        });

        auth.MapGet("/antiforgery", (HttpContext http, IAntiforgery antiforgery, IHostEnvironment environment) =>
        {
            var tokens = antiforgery.GetAndStoreTokens(http);
            http.Response.Cookies.Append(XsrfCookieName, tokens.RequestToken!, new CookieOptions
            {
                HttpOnly = false,
                SameSite = SameSiteMode.Strict,
                Path = "/",
                Secure = !environment.IsDevelopment() || http.Request.IsHttps,
            });
            return TypedResults.NoContent();
        });

        auth.MapPost("/logout", async (HttpContext http, SignInManager<User> signIn) =>
        {
            if (http.User.Identity?.IsAuthenticated == true) await signIn.SignOutAsync();
            return TypedResults.NoContent();
        });

        return auth;
    }

    /// <summary>
    /// Middleware: <c>/api/auth/manage/**</c> and Identity's <c>GET /api/auth/confirmEmail</c> (mapped only so its route name
    /// builds the confirmation link) are not exposed.
    /// </summary>
    public static Task HideIdentityManage(HttpContext http, RequestDelegate next)
        => http.Request.Path.StartsWithSegments(Manage, StringComparison.OrdinalIgnoreCase)
            || (HttpMethods.IsGet(http.Request.Method) && http.Request.Path.Equals(ConfirmEmail, StringComparison.OrdinalIgnoreCase))
            ? Problems.NotFound().ExecuteAsync(http)
            : next(http);

    /// <summary>
    /// Middleware: every POST, PUT, PATCH and DELETE authenticated by the Identity cookie needs a valid <c>X-XSRF-TOKEN</c>,
    /// except the anonymous JSON auth endpoints. Bearer-authenticated and anonymous requests are exempt.
    /// </summary>
    public static async Task EnforceAntiforgery(HttpContext http, RequestDelegate next)
    {
        var method = http.Request.Method;
        if ((HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method))
            && http.User.Identity?.IsAuthenticated == true
            && !AntiforgeryExempt.Any(path => http.Request.Path.Equals(path, StringComparison.OrdinalIgnoreCase))
            && !(await http.AuthenticateAsync(IdentityConstants.BearerScheme)).Succeeded
            && !await http.RequestServices.GetRequiredService<IAntiforgery>().IsRequestValidAsync(http))
        {
            await Problems.Antiforgery().ExecuteAsync(http);
            return;
        }

        await next(http);
    }

    /// <summary>
    /// Rate-limits the mail-sending endpoints per email address. A registration with
    /// a taken address answers like a new one: an account that never confirmed its email (so it was never signed in) is
    /// replaced by the new registration; a confirmed one stays and its owner gets the "already registered" email.
    /// forgotPassword also mails a reset code to an unconfirmed account, and resetPassword works for one and confirms its email.
    /// </summary>
    private static async ValueTask<object?> IdentityFilter(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.Request.Path.Equals(ResetPassword, StringComparison.OrdinalIgnoreCase)
            && context.Arguments.OfType<ResetPasswordRequest>().FirstOrDefault() is { } reset)
            return await ResetPasswordAsync(http.RequestServices.GetRequiredService<UserManager<User>>(), reset);

        var email = context.Arguments
            .Select(argument => argument switch
            {
                RegisterRequest r => r.Email,
                ResendConfirmationEmailRequest r => r.Email,
                ForgotPasswordRequest r => r.Email,
                _ => null,
            })
            .FirstOrDefault(e => e is not null);
        if (email is not null)
        {
            using var lease = http.RequestServices.GetRequiredService<PartitionedRateLimiter<string>>()
                .AttemptAcquire(email.Trim().ToUpperInvariant());
            if (!lease.IsAcquired) return RateLimits.Reject(http, lease, RateLimits.MailWindow);
        }

        var result = await next(context);

        if (http.Request.Path.Equals(Register, StringComparison.OrdinalIgnoreCase)
            && DuplicateErrors(result) is { } errors
            && email is not null)
        {
            var remaining = errors.Where(e => !IsDuplicate(e.Key)).ToDictionary();
            if (remaining.Count > 0) return Problems.Validation(remaining);

            var users = http.RequestServices.GetRequiredService<UserManager<User>>();
            if (await users.FindByEmailAsync(email) is { EmailConfirmed: false } unconfirmed
                && (await users.GetLoginsAsync(unconfirmed)).Count == 0
                && (await users.DeleteAsync(unconfirmed)).Succeeded)
            {
                result = await next(context);
                if (DuplicateErrors(result) is null) return result;
            }

            await http.RequestServices.GetRequiredService<EmberEmailSender>().SendAlreadyRegisteredAsync(email);
            return TypedResults.Ok();
        }

        if (http.Request.Path.Equals(ForgotPassword, StringComparison.OrdinalIgnoreCase) && email is not null)
        {
            var users = http.RequestServices.GetRequiredService<UserManager<User>>();
            if (await users.FindByEmailAsync(email) is { EmailConfirmed: false } unconfirmed)
            {
                var code = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GeneratePasswordResetTokenAsync(unconfirmed)));
                await http.RequestServices.GetRequiredService<EmberEmailSender>().SendPasswordResetCodeAsync(unconfirmed, email, code);
            }
        }

        return result;
    }

    /// <summary>Identity's resetPassword (same request and error shapes) that also accepts an unconfirmed account and confirms it.</summary>
    private static async Task<IResult> ResetPasswordAsync(UserManager<User> users, ResetPasswordRequest request)
    {
        var user = await users.FindByEmailAsync(request.Email ?? "");
        var code = DecodeCode(request.ResetCode);
        if (user is null || code is null)
            return IdentityValidation(IdentityResult.Failed(users.ErrorDescriber.InvalidToken()));

        var result = await users.ResetPasswordAsync(user, code, request.NewPassword ?? "");
        if (!result.Succeeded) return IdentityValidation(result);

        if (!user.EmailConfirmed)
        {
            var confirmed = await users.ConfirmEmailAsync(user, await users.GenerateEmailConfirmationTokenAsync(user));
            if (!confirmed.Succeeded) return IdentityValidation(confirmed);
        }

        return TypedResults.Ok();
    }

    private static IResult IdentityValidation(IdentityResult result)
        => Problems.Validation(result.Errors.GroupBy(e => e.Code).ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray()));

    /// <summary>An emailed Identity code (Base64Url-encoded token) decoded, or null when it is malformed.</summary>
    private static string? DecodeCode(string? code)
    {
        try
        {
            return Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(code ?? ""));
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static IResult? Unwrap(object? result) => (result as INestedHttpResult)?.Result ?? result as IResult;

    private static IDictionary<string, string[]>? DuplicateErrors(object? result)
        => Unwrap(result) is ValidationProblem { ProblemDetails.Errors: var errors } && errors.Keys.Any(IsDuplicate) ? errors : null;

    private static bool IsDuplicate(string code) => code is "DuplicateUserName" or "DuplicateEmail";
}
