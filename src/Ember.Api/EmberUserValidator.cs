using Ember.Core.Localization;
using Ember.Core.Models;
using Microsoft.AspNetCore.Identity;

namespace Ember.Api;

/// <summary>
/// Identity's user validation, except that an account without an email (bot-only or Discord-only) stays valid, so
/// <see cref="UserManager{TUser}"/> can update it. A given email must still be valid and unique; registration requires one.
/// During registration it also sets the new account's <see cref="User.Language"/> from the request's <c>Accept-Language</c>,
/// before the account is saved and its confirmation email is written.
/// </summary>
internal sealed class EmberUserValidator(IdentityErrorDescriber errors, IHttpContextAccessor http) : UserValidator<User>(errors)
{
    public override async Task<IdentityResult> ValidateAsync(UserManager<User> manager, User user)
    {
        if (http.HttpContext?.Request is { } request && HttpMethods.IsPost(request.Method)
            && request.Path.Value?.EndsWith("/register", StringComparison.OrdinalIgnoreCase) == true)
            user.Language = Languages.FromAcceptLanguage(request.Headers.AcceptLanguage);

        var result = await base.ValidateAsync(manager, user);
        if (result.Succeeded || user.Email is not null) return result;

        var remaining = result.Errors.Where(e => e.Code != nameof(IdentityErrorDescriber.InvalidEmail)).ToArray();
        return remaining.Length == 0 ? IdentityResult.Success : IdentityResult.Failed(remaining);
    }
}
