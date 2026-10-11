namespace Ember.Bot.Services;

public enum DeliveryOutcome
{
    Delivered,
    UserNotFound,
    Undeliverable
}

/// <param name="RecentCompletions">Completed check-ins in the 7 local days before today; picks the tone.</param>
/// <param name="Snoozed">True when this is the follow-up of a snooze rather than the daily reminder.</param>
public sealed record Reminder(ulong UserId, int HabitId, string HabitName, int RecentCompletions, bool Snoozed);

/// <summary>Delivers a due habit reminder to a user (Discord DM today, web push later).</summary>
public interface IReminderChannel
{
    Task<DeliveryOutcome> SendAsync(Reminder reminder, CancellationToken cancellationToken = default);
}
