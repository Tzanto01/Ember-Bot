using System.Globalization;
using Ember.Core.Models;

namespace Ember.Core.Services;

/// <summary>Where the server sends one habit's or routine's reminder: Discord DMs and the ids of the push subscriptions.</summary>
public sealed record ReminderTargets(bool Discord, IReadOnlyList<int> PushSubscriptionIds)
{
    /// <summary>True when the reminder goes to at least one server destination.</summary>
    public bool Any => Discord || PushSubscriptionIds.Count > 0;
}

/// <summary>
/// Reminder destination ids (<c>discord</c>, <c>browser-&lt;pushSubscriptionId&gt;</c>, <c>phone-&lt;phoneId&gt;</c>) and the one
/// resolver of a habit's or routine's server targets.
/// </summary>
public static class ReminderDestinations
{
    public const string Discord = "discord";
    public const string BrowserPrefix = "browser-";
    public const string PhonePrefix = "phone-";

    public static string Browser(int pushSubscriptionId) => BrowserPrefix + pushSubscriptionId.ToString(CultureInfo.InvariantCulture);

    public static string Phone(int phoneId) => PhonePrefix + phoneId.ToString(CultureInfo.InvariantCulture);

    /// <summary>
    /// The server targets of an item with <paramref name="exclusions"/>: Discord when the user has a Discord login, answered yes
    /// (<see cref="User.DiscordReminders"/>), DM reminders aren't paused and <see cref="Discord"/> isn't excluded; and each enabled
    /// push subscription whose id isn't excluded, by id. Needs <see cref="User.Logins"/> and <see cref="User.PushSubscriptions"/> loaded.
    /// </summary>
    public static ReminderTargets Resolve(User user, IReadOnlyCollection<string> exclusions)
        => new(
            user.DiscordId() is not null && user.DiscordReminders == true && user.DmRemindersPausedAt is null && !exclusions.Contains(Discord),
            user.PushSubscriptions.Where(s => s.Enabled && !exclusions.Contains(Browser(s.Id))).Select(s => s.Id).Order().ToList());

    /// <summary>
    /// The ids of the user's current destinations: Discord when linked, each push subscription and each phone. Needs
    /// <see cref="User.Logins"/>, <see cref="User.PushSubscriptions"/> and <see cref="User.ReminderPhones"/> loaded.
    /// </summary>
    public static HashSet<string> Ids(User user)
    {
        var ids = user.PushSubscriptions.Select(s => Browser(s.Id)).Concat(user.ReminderPhones.Select(p => Phone(p.Id))).ToHashSet();
        if (user.DiscordId() is not null) ids.Add(Discord);
        return ids;
    }

    /// <summary>The legacy <c>reminderChannels</c> names of <paramref name="targets"/>: <c>mobile</c> when no server destination is a target.</summary>
    public static List<string> LegacyChannels(ReminderTargets targets)
        => !targets.Any
            ? ["mobile"]
            : HabitService.ReminderChannelNames((targets.Discord ? ReminderChannels.Discord : ReminderChannels.None)
                | (targets.PushSubscriptionIds.Count > 0 ? ReminderChannels.WebPush : ReminderChannels.None));
}
