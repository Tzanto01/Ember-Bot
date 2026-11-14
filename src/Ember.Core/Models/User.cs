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

    /// <summary>The account's app theme id (one of <see cref="Themes"/>); null until the user picks one. The bot ignores it.</summary>
    public string? Theme { get; set; }

    /// <summary>
    /// Minutes after a sent habit or routine reminder that one second reminder follows while the day is still open; 0 turns it off.
    /// One of <see cref="SecondReminderChoices"/>.
    /// </summary>
    public int SecondReminderMinutes { get; set; }

    /// <summary>
    /// Whether streak counts are shown to the user (app and bot). False for new accounts; the migration that added it set it true
    /// for every account that existed then.
    /// </summary>
    public bool ShowStreaks { get; set; }

    /// <summary>
    /// The account's language (one of <see cref="Localization.Languages.All"/>) for the app, emails, notifications and the bot.
    /// A new account takes it from the sign-up request or the Discord interaction's locale.
    /// </summary>
    public string Language { get; set; } = Localization.Languages.English;

    /// <summary>Whether the app shows its calm mode. False for new accounts and for every account that existed when it was added.</summary>
    public bool CalmMode { get; set; }

    /// <summary>
    /// The ids (from <see cref="TipIds"/>) of the one-time tips this account has answered or dismissed. Empty for new accounts; the
    /// migration that added it set <see cref="StreaksTip"/> for every account that existed then.
    /// </summary>
    public List<string> TipsSeen { get; set; } = [];

    /// <summary>The tip that asks whether to show streaks.</summary>
    public const string StreaksTip = "streaks";

    /// <summary>The tip ids <see cref="TipsSeen"/> may hold.</summary>
    public static readonly IReadOnlySet<string> TipIds = new HashSet<string> { StreaksTip, "private-journal", "routines", "android", "discord" };

    /// <summary>The values <see cref="SecondReminderMinutes"/> may hold.</summary>
    public static readonly IReadOnlySet<int> SecondReminderChoices = new HashSet<int> { 0, 15, 30, 60, 120 };

    /// <summary>The theme ids <see cref="Theme"/> may hold.</summary>
    public static readonly IReadOnlySet<string> Themes = new HashSet<string> { "hearthlight", "fieldnotes", "tidepool", "marigold" };

    /// <summary>Consecutive reminder DMs that Discord refused to deliver. Reset by any delivered reminder.</summary>
    public int DmFailureCount { get; set; }

    /// <summary>Set when DM reminders stopped after repeated undeliverable DMs; null while they are active.</summary>
    public DateTime? DmRemindersPausedAt { get; set; }

    /// <summary>When the user was told their DM reminders are paused, so the notice is shown only once.</summary>
    public DateTime? DmPauseNoticeSentAt { get; set; }

    /// <summary>The account's answer to "remind me in Discord DMs": null until answered; reminders go to Discord only when true.</summary>
    public bool? DiscordReminders { get; set; }

    /// <summary>When the bot asked about <see cref="DiscordReminders"/>, so it asks at most once; set whether or not the DM arrived.</summary>
    public DateTime? DiscordRemindersAskedAt { get; set; }

    /// <summary>When (UTC) the user explicitly agreed that Ember may store habit names and check-ins (GDPR Art. 9(2)(a)); null until they agree.</summary>
    public DateTime? HealthDataConsentAt { get; set; }

    /// <summary>The privacy policy version the consent in <see cref="HealthDataConsentAt"/> was given for.</summary>
    public string? ConsentPolicyVersion { get; set; }

    /// <summary>
    /// The user's local day on which Ember last asked for consent, so it asks at most once per day. After a "No thanks" it holds the
    /// last day of the back-off instead (<see cref="Services.HabitService.ConsentDeclineBackoffDays"/>), so the next ask comes after it.
    /// </summary>
    public DateOnly? ConsentPromptedOn { get; set; }

    /// <summary>SHA-256 (hex) of the newest emailed sign-up code; null when none is pending.</summary>
    public string? EmailCodeHash { get; set; }

    /// <summary>When (UTC) the code in <see cref="EmailCodeHash"/> stops working.</summary>
    public DateTime? EmailCodeExpiresAt { get; set; }

    /// <summary>SHA-256 (hex) of the sign-up key of the device that asked for the code in <see cref="EmailCodeHash"/>; null when it sent none.</summary>
    public string? EmailCodeKeyHash { get; set; }

    /// <summary>Tries spent on the code in <see cref="EmailCodeHash"/>; at the limit it no longer works.</summary>
    public int EmailCodeTries { get; set; }

    public ICollection<IdentityUserLogin<Guid>> Logins { get; set; } = new List<IdentityUserLogin<Guid>>();
    public ICollection<Habit> Habits { get; set; } = new List<Habit>();
    public ICollection<DayMark> DayMarks { get; set; } = new List<DayMark>();
    public ICollection<PushSubscription> PushSubscriptions { get; set; } = new List<PushSubscription>();
    public ICollection<Routine> Routines { get; set; } = new List<Routine>();
    public ICollection<ReminderPhone> ReminderPhones { get; set; } = new List<ReminderPhone>();
    public ICollection<DayNote> DayNotes { get; set; } = new List<DayNote>();
    public ICollection<Mood> Moods { get; set; } = new List<Mood>();

    /// <summary>The wrapped private-journal key; null while the private journal is off.</summary>
    public JournalKey? JournalKey { get; set; }

    /// <summary>The encrypted "What helps me" list; null when there is none.</summary>
    public UserHelps? Helps { get; set; }
}
