using Ember.Core.Models;
using Microsoft.AspNetCore.Identity;

namespace Ember.Api;

/// <summary>
/// Identity's user validation, except that an account without an email (bot-only or Discord-only) stays valid, so
/// <see cref="UserManager{TUser}"/> can update it. A given email must still be valid and unique; registration requires one.
/// </summary>
internal sealed class EmberUserValidator(IdentityErrorDescriber errors) : UserValidator<User>(errors)
{
    public override async Task<IdentityResult> ValidateAsync(UserManager<User> manager, User user)
    {
        var result = await base.ValidateAsync(manager, user);
        if (result.Succeeded || user.Email is not null) return result;

        var remaining = result.Errors.Where(e => e.Code != nameof(IdentityErrorDescriber.InvalidEmail)).ToArray();
        return remaining.Length == 0 ? IdentityResult.Success : IdentityResult.Failed(remaining);
    }
}
