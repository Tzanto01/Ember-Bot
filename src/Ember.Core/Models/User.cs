using Microsoft.AspNetCore.Identity;

namespace Ember.Core.Models;

/// <summary>
/// An Ember account. A Discord user is linked through a <see cref="Logins"/> row with
/// <see cref="DiscordLogin.Provider"/>; a bot-only user has no email and no password.
/// </summary>
public class User : IdentityUser<Guid>
{
    public string Timezone { get; set; } = "UTC";

    /// <summary>
    /// Number of missed days per week that are forgiven before breaking a streak.
    /// Default 1. Users can adjust with /streak grace.
    /// </summary>
    public int GraceDaysPerWeek { get; set; } = 1;

    /// <summary>
    /// When true, this user appears on leaderboards. Off by default: only an explicit
    /// opt-in (via /privacy optin or the leaderboard button) turns it on.
    /// </summary>
    public bool LeaderboardOptIn { get; set; }

    /// <summary>Consecutive reminder DMs that Discord refused to deliver. Reset by any delivered reminder.</summary>
    public int DmFailureCount { get; set; }

    /// <summary>Set when DM reminders stopped after repeated undeliverable DMs; null while they are active.</summary>
    public DateTime? DmRemindersPausedAt { get; set; }

    /// <summary>When the user was told their DM reminders are paused, so the notice is shown only once.</summary>
    public DateTime? DmPauseNoticeSentAt { get; set; }

    /// <summary>When (UTC) the user explicitly agreed that Ember may store habit names and check-ins (GDPR Art. 9(2)(a)); null until they agree.</summary>
    public DateTime? HealthDataConsentAt { get; set; }

    /// <summary>The privacy policy version the consent in <see cref="HealthDataConsentAt"/> was given for.</summary>
    public string? ConsentPolicyVersion { get; set; }

    /// <summary>The user's local day on which Ember last asked for consent, so it asks at most once per day.</summary>
    public DateOnly? ConsentPromptedOn { get; set; }

    public ICollection<IdentityUserLogin<Guid>> Logins { get; set; } = new List<IdentityUserLogin<Guid>>();
    public ICollection<Habit> Habits { get; set; } = new List<Habit>();
    public ICollection<DayMark> DayMarks { get; set; } = new List<DayMark>();
}
