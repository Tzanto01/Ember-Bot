using Ember.Core.Models;

namespace Ember.Bot.Services;

public enum DeliveryOutcome
{
    Delivered,
    UserNotFound,
    Undeliverable
}

/// <param name="UserId">The Ember user ID.</param>
/// <param name="DiscordUserId">The user's Discord ID, null when no Discord login is linked.</param>
/// <param name="RecentCompletions">Completed check-ins in the 7 local days before today; picks the tone.</param>
/// <param name="Snoozed">True when this is the follow-up of a snooze rather than the daily reminder.</param>
public sealed record Reminder(Guid UserId, ulong? DiscordUserId, int HabitId, string HabitName, int RecentCompletions, bool Snoozed);

/// <summary>Delivers a due habit reminder to a user through one channel (Discord DM, web push).</summary>
public interface IReminderChannel
{
    /// <summary>The habit reminder channel this implementation delivers.</summary>
    ReminderChannels Channel { get; }

    Task<DeliveryOutcome> SendAsync(Reminder reminder, CancellationToken cancellationToken = default);
}
