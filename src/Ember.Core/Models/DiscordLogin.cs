using Microsoft.AspNetCore.Identity;

namespace Ember.Core.Models;

/// <summary>How a Discord account is stored as an Identity external login.</summary>
public static class DiscordLogin
{
    /// <summary><c>AspNetUserLogins.LoginProvider</c> of a Discord login. Must match the Discord OAuth handler's scheme name.</summary>
    public const string Provider = "Discord";

    /// <summary><c>AspNetUserLogins.ProviderKey</c>: the Discord user ID as a decimal string, as the OAuth handler reports it.</summary>
    public static string Key(ulong discordUserId) => discordUserId.ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>Synthetic user name of a bot-only user, so Identity's required fields are always filled.</summary>
    public static string UserName(ulong discordUserId) => $"discord_{Key(discordUserId)}";

    /// <summary>The user's Discord ID, or null when they have no Discord login. Needs <see cref="User.Logins"/> loaded.</summary>
    public static ulong? DiscordId(this User user)
        => user.Logins.FirstOrDefault(l => l.LoginProvider == Provider) is { } login ? ulong.Parse(login.ProviderKey, System.Globalization.CultureInfo.InvariantCulture) : null;
}
