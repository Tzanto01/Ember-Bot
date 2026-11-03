using Ember.Core.Models;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Ember.Core.Services;

/// <summary>
/// Builds a user's complete data export (GDPR Art. 15/20): settings, every habit (including habits
/// without logs), every log, every day mark, every push subscription endpoint, every routine, journal entry and own mood,
/// and the wrapped private-journal key. Expects <see cref="User.Habits"/>, each habit's logs, <see cref="User.DayMarks"/>,
/// <see cref="User.Routines"/>, <see cref="User.DayNotes"/>, <see cref="User.Moods"/> and <see cref="User.JournalKey"/> to be loaded.
/// The JSON document is also the import format.
/// </summary>
public static class ExportBuilder
{
    /// <summary>
    /// Column header of the CSV export. One row per record, discriminated by <c>record_type</c>. Columns after <c>discord_id</c>:
    /// <c>two_factor_enabled</c> (settings); <c>days</c> (habit weekdays joined with <c>;</c>), <c>times_per_day</c>, <c>routine_id</c> (habit, routine);
    /// <c>count</c> (log); <c>routine_position</c> (habit, its order inside its routine); <c>text</c>, <c>mood</c> (day_note);
    /// <c>mood_id</c>, <c>label</c>, <c>emoji</c>, <c>archived</c> (mood); <c>cipher_version</c>, <c>cipher_iv</c>, <c>cipher_text</c>
    /// (encrypted day_note or mood); <c>version</c>, <c>turning_off</c>, <c>passphrase_salt</c>, <c>passphrase_iterations</c>,
    /// <c>passphrase_iv</c>, <c>passphrase_wrapped</c>, <c>recovery_salt</c>, <c>recovery_iv</c>, <c>recovery_wrapped</c> (journal_key).
    /// </summary>
    public const string CsvHeader =
        "record_type,timezone,grace_days_per_week,theme," +
        "dm_failure_count,dm_reminders_paused_at,dm_pause_notice_sent_at," +
        "health_data_consent_at,consent_policy_version,consent_prompted_on," +
        "habit_id,name,frequency,weekly_target,reminder_time,paused_until,paused_from,created_at,next_reminder_utc," +
        "date,completed,guild_id,kind,reminder_channels,endpoint,email,discord_id," +
        "two_factor_enabled,days,times_per_day,routine_id,count,routine_position,text,mood,mood_id,label,emoji,archived," +
        "cipher_version,cipher_iv,cipher_text,version,turning_off," +
        "passphrase_salt,passphrase_iterations,passphrase_iv,passphrase_wrapped,recovery_salt,recovery_iv,recovery_wrapped";

    private static readonly string[] CsvColumns = CsvHeader.Split(',');

    /// <summary>The version written to <see cref="ExportDocument.FormatVersion"/>; import accepts only this one.</summary>
    public const int CurrentFormatVersion = 2;

    /// <summary>The JSON options of the export (snake_case), also used to read an import.</summary>
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = true,
    };

    /// <summary>
    /// Settings, reminder delivery state and health-data consent of the exported user. Timestamps are UTC.
    /// <c>TwoFactorEnabled</c> only says whether two-factor sign-in is on; authenticator keys and recovery codes are never exported.
    /// </summary>
    public sealed record SettingsRecord(
        string Timezone, int GraceDaysPerWeek, string? Theme,
        int DmFailureCount, DateTime? DmRemindersPausedAt, DateTime? DmPauseNoticeSentAt,
        DateTime? HealthDataConsentAt, string? ConsentPolicyVersion, DateOnly? ConsentPromptedOn, bool TwoFactorEnabled);

    /// <summary>
    /// One habit. Dates are ISO 8601; <c>CreatedAt</c> and <c>NextReminderUtc</c> are UTC. <c>ReminderChannels</c> holds any of <c>discord</c>, <c>webpush</c> and <c>mobile</c>.
    /// <c>Days</c> lists the weekdays (<c>mon</c> … <c>sun</c>, Monday first) of a <c>weekdays</c> habit, null otherwise.
    /// <c>RoutinePosition</c> is the habit's order inside its routine, null when it has none.
    /// </summary>
    public sealed record HabitRecord(
        int Id, string Name, string Frequency, int? WeeklyTarget,
        TimeOnly? ReminderTime, DateOnly? PausedUntil, DateOnly? PausedFrom, DateTime CreatedAt, DateTime? NextReminderUtc,
        List<string> ReminderChannels, List<string>? Days, int TimesPerDay, int? RoutineId, int? RoutinePosition);

    /// <summary>One routine; its members are the habits with its <c>RoutineId</c>. Timestamps are UTC.</summary>
    public sealed record RoutineRecord(
        int Id, string Name, TimeOnly? ReminderTime, DateTime? NextReminderUtc, List<string> ReminderChannels, DateTime CreatedAt);

    /// <summary>A client-side AES-GCM ciphertext as stored (<c>V</c> format version, base64 <c>Iv</c> and <c>Ct</c>).</summary>
    public sealed record EncryptedRecord(int V, string Iv, string Ct);

    /// <summary>The journal entry of one local day: plaintext <c>Text</c>/<c>Mood</c>, or <c>Encrypted</c> with both null.</summary>
    public sealed record DayNoteRecord(DateOnly Date, string? Text, string? Mood, EncryptedRecord? Encrypted);

    /// <summary>One own mood: plaintext <c>Label</c>/<c>Emoji</c>, or <c>Encrypted</c> with both null. <c>CreatedAt</c> is UTC.</summary>
    public sealed record MoodRecord(int Id, string? Label, string? Emoji, bool Archived, EncryptedRecord? Encrypted, DateTime CreatedAt);

    /// <summary>The journal key wrapped by the passphrase-derived key (base64).</summary>
    public sealed record PassphraseWrapRecord(string Salt, int Iterations, string Iv, string Wrapped);

    /// <summary>The journal key wrapped by the recovery-code-derived key (base64).</summary>
    public sealed record RecoveryWrapRecord(string Salt, string Iv, string Wrapped);

    /// <summary>The wrapped private-journal key as stored; the server never has the unwrapped key.</summary>
    public sealed record JournalKeyRecord(int Version, bool TurningOff, PassphraseWrapRecord Passphrase, RecoveryWrapRecord Recovery);

    /// <summary>One browser push subscription: its endpoint and when (UTC) it was last saved. Keys are not exported.</summary>
    public sealed record PushSubscriptionRecord(string Endpoint, DateTime CreatedAt);

    /// <summary>
    /// One check-in log. <c>GuildId</c> is a string because Discord snowflakes exceed JSON's safe integer range.
    /// <c>Completed</c> is the stored done flag (set when <c>Count</c> reached the target at the time of the check-in).
    /// </summary>
    public sealed record LogRecord(int HabitId, DateOnly Date, bool Completed, string? GuildId, int Count);

    /// <summary>One mark on a local day, such as a low day (<c>Kind</c> = <c>low_day</c>).</summary>
    public sealed record DayMarkRecord(DateOnly Date, string Kind);

    /// <summary>The account's email (null for accounts created through Discord) and Discord ID (a string, null when not linked).</summary>
    public sealed record AccountRecord(string? Email, string? DiscordId);

    /// <summary>The JSON export document. <c>JournalKey</c> is null while the private journal is off.</summary>
    public sealed record ExportDocument(SettingsRecord Settings, List<HabitRecord> Habits, List<LogRecord> Logs, List<DayMarkRecord> DayMarks,
        AccountRecord? Account = null, List<PushSubscriptionRecord>? PushSubscriptions = null,
        List<RoutineRecord>? Routines = null, List<DayNoteRecord>? DayNotes = null, List<MoodRecord>? Moods = null,
        JournalKeyRecord? JournalKey = null)
    {
        /// <summary>The export format version (<see cref="CurrentFormatVersion"/>), written first.</summary>
        [JsonPropertyOrder(-1)]
        public int FormatVersion { get; init; } = CurrentFormatVersion;
    }

    /// <summary>
    /// Builds the export. <see cref="ExportDocument.Account"/> needs <see cref="User.Logins"/> loaded for the Discord ID,
    /// <see cref="ExportDocument.PushSubscriptions"/> needs <see cref="User.PushSubscriptions"/>.
    /// </summary>
    public static ExportDocument BuildDocument(User user)
    {
        var habits = user.Habits.OrderBy(h => h.CreatedAt).ThenBy(h => h.Id).ToList();
        return new ExportDocument(
            new SettingsRecord(user.Timezone, user.GraceDaysPerWeek, user.Theme,
                user.DmFailureCount, AsUtc(user.DmRemindersPausedAt), AsUtc(user.DmPauseNoticeSentAt),
                AsUtc(user.HealthDataConsentAt), user.ConsentPolicyVersion, user.ConsentPromptedOn, user.TwoFactorEnabled),
            habits.Select(h => new HabitRecord(
                h.Id, h.Name, h.FrequencyType.ToString().ToLowerInvariant(), h.WeeklyTarget,
                h.ReminderTime, h.PausedUntil, h.PausedFrom, DateTime.SpecifyKind(h.CreatedAt, DateTimeKind.Utc),
                AsUtc(h.NextReminderUtc), HabitService.ReminderChannelNames(h.ReminderChannels),
                h.Days is { } days ? ScheduleDayNames.ToNames(days) : null, h.TimesPerDay, h.RoutineId,
                h.RoutineId is null ? null : h.RoutinePosition)).ToList(),
            habits.SelectMany(h => h.Logs.OrderBy(l => l.Date).Select(l => new LogRecord(
                h.Id, l.Date, l.Completed, l.GuildId?.ToString(CultureInfo.InvariantCulture), l.Count))).ToList(),
            user.DayMarks.OrderBy(m => m.Date).ThenBy(m => m.Kind)
                .Select(m => new DayMarkRecord(m.Date, JsonNamingPolicy.SnakeCaseLower.ConvertName(m.Kind.ToString()))).ToList(),
            new AccountRecord(user.Email, user.DiscordId() is { } discordId ? DiscordLogin.Key(discordId) : null),
            user.PushSubscriptions.OrderBy(p => p.CreatedAt).ThenBy(p => p.Id)
                .Select(p => new PushSubscriptionRecord(p.Endpoint, DateTime.SpecifyKind(p.CreatedAt, DateTimeKind.Utc))).ToList(),
            user.Routines.OrderBy(r => r.CreatedAt).ThenBy(r => r.Id).Select(r => new RoutineRecord(
                r.Id, r.Name, r.ReminderTime, AsUtc(r.NextReminderUtc), HabitService.ReminderChannelNames(r.ReminderChannels),
                DateTime.SpecifyKind(r.CreatedAt, DateTimeKind.Utc))).ToList(),
            user.DayNotes.OrderBy(n => n.Date).Select(n => new DayNoteRecord(
                n.Date, n.Text, n.Mood, Encrypted(n.CipherVersion, n.CipherIv, n.CipherText))).ToList(),
            user.Moods.OrderBy(m => m.Id).Select(m => new MoodRecord(
                m.Id, m.Label, m.Emoji, m.Archived, Encrypted(m.CipherVersion, m.CipherIv, m.CipherText),
                DateTime.SpecifyKind(m.CreatedAt, DateTimeKind.Utc))).ToList(),
            user.JournalKey is { } k
                ? new JournalKeyRecord(k.Version, k.TurningOff,
                    new PassphraseWrapRecord(k.PassphraseSalt, k.PassphraseIterations, k.PassphraseIv, k.PassphraseWrapped),
                    new RecoveryWrapRecord(k.RecoverySalt, k.RecoveryIv, k.RecoveryWrapped))
                : null);
    }

    private static EncryptedRecord? Encrypted(int? version, string? iv, string? ct)
        => version is { } v ? new EncryptedRecord(v, iv ?? "", ct ?? "") : null;

    public static string BuildJson(User user) => JsonSerializer.Serialize(BuildDocument(user), JsonOptions);

    /// <summary>
    /// One CSV file with <see cref="CsvHeader"/> columns: a <c>settings</c> row, one <c>habit</c> row per habit,
    /// one <c>log</c> row per log, one <c>day_mark</c> row per day mark, one <c>push_subscription</c> row per push subscription,
    /// one <c>routine</c> row per routine, one <c>day_note</c> row per journal entry, one <c>mood</c> row per own mood and a
    /// <c>journal_key</c> row when the private journal is on (reminder channels are joined with <c>;</c>); columns that don't apply to a record type are empty.
    /// Cells starting with a formula character are prefixed with <c>'</c> so spreadsheets don't evaluate them.
    /// </summary>
    public static string BuildCsv(User user)
    {
        var doc = BuildDocument(user);
        var csv = new StringBuilder();
        csv.Append(CsvHeader).Append("\r\n");

        var s = doc.Settings;
        AppendRow(csv, "settings", ("timezone", s.Timezone), ("grace_days_per_week", Num(s.GraceDaysPerWeek)), ("theme", s.Theme ?? ""),
            ("dm_failure_count", Num(s.DmFailureCount)), ("dm_reminders_paused_at", Utc(s.DmRemindersPausedAt)),
            ("dm_pause_notice_sent_at", Utc(s.DmPauseNoticeSentAt)), ("health_data_consent_at", Utc(s.HealthDataConsentAt)),
            ("consent_policy_version", s.ConsentPolicyVersion ?? ""), ("consent_prompted_on", Date(s.ConsentPromptedOn)),
            ("email", doc.Account?.Email ?? ""), ("discord_id", doc.Account?.DiscordId ?? ""),
            ("two_factor_enabled", Bool(s.TwoFactorEnabled)));

        foreach (var h in doc.Habits)
            AppendRow(csv, "habit", ("habit_id", Num(h.Id)), ("name", h.Name), ("frequency", h.Frequency),
                ("weekly_target", h.WeeklyTarget is { } t ? Num(t) : ""), ("reminder_time", Time(h.ReminderTime)),
                ("paused_until", Date(h.PausedUntil)), ("paused_from", Date(h.PausedFrom)),
                ("created_at", Utc(h.CreatedAt)), ("next_reminder_utc", Utc(h.NextReminderUtc)),
                ("reminder_channels", string.Join(';', h.ReminderChannels)), ("days", string.Join(';', h.Days ?? [])),
                ("times_per_day", Num(h.TimesPerDay)), ("routine_id", h.RoutineId is { } r ? Num(r) : ""),
                ("routine_position", h.RoutinePosition is { } p ? Num(p) : ""));

        foreach (var l in doc.Logs)
            AppendRow(csv, "log", ("habit_id", Num(l.HabitId)), ("date", Date(l.Date)), ("completed", Bool(l.Completed)),
                ("guild_id", l.GuildId ?? ""), ("count", Num(l.Count)));

        foreach (var m in doc.DayMarks)
            AppendRow(csv, "day_mark", ("date", Date(m.Date)), ("kind", m.Kind));

        foreach (var p in doc.PushSubscriptions ?? [])
            AppendRow(csv, "push_subscription", ("created_at", Utc(p.CreatedAt)), ("endpoint", p.Endpoint));

        foreach (var r in doc.Routines ?? [])
            AppendRow(csv, "routine", ("routine_id", Num(r.Id)), ("name", r.Name), ("reminder_time", Time(r.ReminderTime)),
                ("next_reminder_utc", Utc(r.NextReminderUtc)), ("reminder_channels", string.Join(';', r.ReminderChannels)),
                ("created_at", Utc(r.CreatedAt)));

        foreach (var n in doc.DayNotes ?? [])
            AppendRow(csv, "day_note", [("date", Date(n.Date)), ("text", n.Text ?? ""), ("mood", n.Mood ?? ""), .. Cipher(n.Encrypted)]);

        foreach (var m in doc.Moods ?? [])
            AppendRow(csv, "mood", [("mood_id", Num(m.Id)), ("label", m.Label ?? ""), ("emoji", m.Emoji ?? ""),
                ("archived", Bool(m.Archived)), ("created_at", Utc(m.CreatedAt)), .. Cipher(m.Encrypted)]);

        if (doc.JournalKey is { } k)
            AppendRow(csv, "journal_key", ("version", Num(k.Version)), ("turning_off", Bool(k.TurningOff)),
                ("passphrase_salt", k.Passphrase.Salt), ("passphrase_iterations", Num(k.Passphrase.Iterations)),
                ("passphrase_iv", k.Passphrase.Iv), ("passphrase_wrapped", k.Passphrase.Wrapped),
                ("recovery_salt", k.Recovery.Salt), ("recovery_iv", k.Recovery.Iv), ("recovery_wrapped", k.Recovery.Wrapped));

        return csv.ToString();
    }

    private static string Num(int value) => value.ToString(CultureInfo.InvariantCulture);
    private static string Bool(bool value) => value ? "true" : "false";
    private static string Date(DateOnly? value) => value?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "";
    private static string Utc(DateTime? value) => value?.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture) ?? "";
    private static DateTime? AsUtc(DateTime? value) => value is { } v ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : null;

    private static string Time(TimeOnly? value) => value?.ToString("HH:mm", CultureInfo.InvariantCulture) ?? "";

    private static (string, string)[] Cipher(EncryptedRecord? encrypted) => encrypted is { } e
        ? [("cipher_version", Num(e.V)), ("cipher_iv", e.Iv), ("cipher_text", e.Ct)]
        : [];

    private static void AppendRow(StringBuilder csv, string recordType, params (string Column, string Value)[] cells)
    {
        var row = new string[CsvColumns.Length];
        Array.Fill(row, "");
        row[0] = recordType;
        foreach (var (column, value) in cells)
        {
            var index = Array.IndexOf(CsvColumns, column);
            if (index < 0) throw new ArgumentException($"Unknown CSV column {column}.", nameof(cells));
            row[index] = value;
        }
        csv.AppendJoin(',', row.Select(Cell));
        csv.Append("\r\n");
    }

    private static string Cell(string value)
    {
        var trimmed = value.TrimStart(' ', '\t', '\r', '\n');
        if ((trimmed.Length > 0 && trimmed[0] is '=' or '+' or '-' or '@') || (value.Length > 0 && value[0] is '\t' or '\r'))
            value = "'" + value;

        return value.IndexOfAny([',', '"', '\r', '\n']) >= 0
            ? "\"" + value.Replace("\"", "\"\"") + "\""
            : value;
    }
}
