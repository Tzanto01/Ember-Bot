namespace Ember.Core.Services;

/// <summary>Outcome of using a reminder action token (<see cref="HabitService.UseReminderActionTokenAsync"/>).</summary>
public enum ReminderActionResult
{
    /// <summary>The check-in was added now, or the token had already been used.</summary>
    Logged,

    /// <summary>No such token, or its habit is gone.</summary>
    Unknown,

    /// <summary>The token expired, or its day can no longer be logged for the habit.</summary>
    Expired,

    /// <summary>The user hasn't agreed to the current health-data consent; the token stays unused.</summary>
    ConsentRequired,
}
