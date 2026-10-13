using Ember.Bot.Models;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Ember.Bot.Services;

/// <summary>
/// Builds a user's complete data export (GDPR Art. 15/20): settings, every habit (including habits
/// without logs), every log and every day mark. Expects <see cref="User.Habits"/>, each habit's logs and <see cref="User.DayMarks"/> to be loaded.
/// </summary>
public static class ExportBuilder
{
    /// <summary>Column header of the CSV export. One row per record, discriminated by <c>record_type</c>.</summary>
    public const string CsvHeader =
        "record_type,timezone,grace_days_per_week,leaderboard_opt_in," +
        "dm_failure_count,dm_reminders_paused_at,dm_pause_notice_sent_at," +
        "health_data_consent_at,consent_policy_version,consent_prompted_on," +
        "habit_id,name,frequency,weekly_target,reminder_time,paused_until,paused_from,created_at,next_reminder_utc," +
        "date,completed,guild_id,kind";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = true,
    };

    /// <summary>Settings, reminder delivery state and health-data consent of the exported user. Timestamps are UTC.</summary>
    public sealed record SettingsRecord(
        string Timezone, int GraceDaysPerWeek, bool LeaderboardOptIn,
        int DmFailureCount, DateTime? DmRemindersPausedAt, DateTime? DmPauseNoticeSentAt,
        DateTime? HealthDataConsentAt, string? ConsentPolicyVersion, DateOnly? ConsentPromptedOn);

    /// <summary>One habit. Dates are ISO 8601; <c>CreatedAt</c> and <c>NextReminderUtc</c> are UTC.</summary>
    public sealed record HabitRecord(
        int Id, string Name, string Frequency, int? WeeklyTarget,
        TimeOnly? ReminderTime, DateOnly? PausedUntil, DateOnly? PausedFrom, DateTime CreatedAt, DateTime? NextReminderUtc);

    /// <summary>One check-in log. <c>GuildId</c> is a string because Discord snowflakes exceed JSON's safe integer range.</summary>
    public sealed record LogRecord(int HabitId, DateOnly Date, bool Completed, string? GuildId);

    /// <summary>One mark on a local day, such as a low day (<c>Kind</c> = <c>low_day</c>).</summary>
    public sealed record DayMarkRecord(DateOnly Date, string Kind);

    /// <summary>The JSON export document.</summary>
    public sealed record ExportDocument(SettingsRecord Settings, List<HabitRecord> Habits, List<LogRecord> Logs, List<DayMarkRecord> DayMarks);

    public static ExportDocument BuildDocument(User user)
    {
        var habits = user.Habits.OrderBy(h => h.CreatedAt).ThenBy(h => h.Id).ToList();
        return new ExportDocument(
            new SettingsRecord(user.Timezone, user.GraceDaysPerWeek, user.LeaderboardOptIn,
                user.DmFailureCount, AsUtc(user.DmRemindersPausedAt), AsUtc(user.DmPauseNoticeSentAt),
                AsUtc(user.HealthDataConsentAt), user.ConsentPolicyVersion, user.ConsentPromptedOn),
            habits.Select(h => new HabitRecord(
                h.Id, h.Name, h.FrequencyType.ToString().ToLowerInvariant(), h.WeeklyTarget,
                h.ReminderTime, h.PausedUntil, h.PausedFrom, DateTime.SpecifyKind(h.CreatedAt, DateTimeKind.Utc),
                AsUtc(h.NextReminderUtc))).ToList(),
            habits.SelectMany(h => h.Logs.OrderBy(l => l.Date).Select(l => new LogRecord(
                h.Id, l.Date, l.Completed, l.GuildId?.ToString(CultureInfo.InvariantCulture)))).ToList(),
            user.DayMarks.OrderBy(m => m.Date).ThenBy(m => m.Kind)
                .Select(m => new DayMarkRecord(m.Date, JsonNamingPolicy.SnakeCaseLower.ConvertName(m.Kind.ToString()))).ToList());
    }

    public static string BuildJson(User user) => JsonSerializer.Serialize(BuildDocument(user), JsonOptions);

    /// <summary>
    /// One CSV file with <see cref="CsvHeader"/> columns: a <c>settings</c> row, one <c>habit</c> row per habit,
    /// one <c>log</c> row per log and one <c>day_mark</c> row per day mark; columns that don't apply to a record type are empty.
    /// Cells starting with a formula character are prefixed with <c>'</c> so spreadsheets don't evaluate them.
    /// </summary>
    public static string BuildCsv(User user)
    {
        var doc = BuildDocument(user);
        var csv = new StringBuilder();
        csv.Append(CsvHeader).Append("\r\n");

        var s = doc.Settings;
        AppendRow(csv, "settings", s.Timezone, Num(s.GraceDaysPerWeek), Bool(s.LeaderboardOptIn),
            Num(s.DmFailureCount), Utc(s.DmRemindersPausedAt), Utc(s.DmPauseNoticeSentAt),
            Utc(s.HealthDataConsentAt), s.ConsentPolicyVersion ?? "", Date(s.ConsentPromptedOn),
            "", "", "", "", "", "", "", "", "", "", "", "", "");

        foreach (var h in doc.Habits)
            AppendRow(csv, "habit", "", "", "", "", "", "", "", "", "",
                Num(h.Id), h.Name, h.Frequency, h.WeeklyTarget is { } t ? Num(t) : "",
                h.ReminderTime?.ToString("HH:mm", CultureInfo.InvariantCulture) ?? "",
                h.PausedUntil?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "", Date(h.PausedFrom),
                Utc(h.CreatedAt), Utc(h.NextReminderUtc),
                "", "", "", "");

        foreach (var l in doc.Logs)
            AppendRow(csv, "log", "", "", "", "", "", "", "", "", "",
                Num(l.HabitId), "", "", "", "", "", "", "", "",
                l.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), Bool(l.Completed), l.GuildId ?? "", "");

        foreach (var m in doc.DayMarks)
            AppendRow(csv, "day_mark", "", "", "", "", "", "", "", "", "",
                "", "", "", "", "", "", "", "", "",
                Date(m.Date), "", "", m.Kind);

        return csv.ToString();
    }

    private static string Num(int value) => value.ToString(CultureInfo.InvariantCulture);
    private static string Bool(bool value) => value ? "true" : "false";
    private static string Date(DateOnly? value) => value?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "";
    private static string Utc(DateTime? value) => value?.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture) ?? "";
    private static DateTime? AsUtc(DateTime? value) => value is { } v ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : null;

    private static void AppendRow(StringBuilder csv, params string[] cells)
    {
        csv.AppendJoin(',', cells.Select(Cell));
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
