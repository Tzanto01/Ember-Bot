using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace Ember.Tests;

/// <summary>Builds seeded users the way the bot stores Discord users: an Ember ID plus a Discord login.</summary>
internal static class TestUsers
{
    /// <summary>A fixed Ember user ID derived from the Discord ID, so tests can name the user without a lookup.</summary>
    public static Guid Id(long discordUserId) => new($"00000000-0000-0000-0000-{discordUserId:x12}");

    public static Guid Id(ulong discordUserId) => Id((long)discordUserId);

    /// <summary>The Ember user ID the bot stored for this Discord user (created through the service, so not <see cref="Id(long)"/>).</summary>
    public static Task<Guid> UserIdAsync(IServiceProvider sp, ulong discordUserId)
        => sp.GetRequiredService<HabitService>().FindDiscordUserAsync(discordUserId);

    /// <summary>The Discord ID a seeded <see cref="Id(long)"/> was derived from.</summary>
    public static long DiscordIdOf(Guid id) => Convert.ToInt64(id.ToString("N")[^12..], 16);

    /// <summary>The Discord login of the seeded user with <see cref="Id(long)"/>.</summary>
    public static List<IdentityUserLogin<Guid>> Discord(long discordUserId) =>
    [
        new()
        {
            LoginProvider = DiscordLogin.Provider,
            ProviderKey = DiscordLogin.Key((ulong)discordUserId),
            ProviderDisplayName = DiscordLogin.Provider,
            UserId = Id(discordUserId),
        },
    ];

    public static List<IdentityUserLogin<Guid>> Discord(ulong discordUserId) => Discord((long)discordUserId);
}
