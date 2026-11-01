using System.Globalization;

namespace Ember.Api;

/// <summary>The contract's wire formats: local dates as <c>yyyy-MM-dd</c>, times of day as <c>HH:mm</c>.</summary>
internal static class Formats
{
    public static bool TryParseDate(string? value, out DateOnly date)
        => DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    public static bool TryParseTime(string? value, out TimeOnly time)
        => TimeOnly.TryParseExact(value, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out time);

    public static string Time(TimeOnly time) => time.ToString("HH:mm", CultureInfo.InvariantCulture);

    /// <summary>The parsed <paramref name="value"/>, or <paramref name="fallback"/> when it is null; a malformed value adds an error for <paramref name="field"/>.</summary>
    public static DateOnly DateOr(string? value, DateOnly fallback, string field, Dictionary<string, string[]> errors)
    {
        if (value is null) return fallback;
        if (TryParseDate(value, out var date)) return date;
        errors[field] = [DateMessage];
        return fallback;
    }

    public const string DateMessage = "Must be a date as yyyy-MM-dd.";
}
