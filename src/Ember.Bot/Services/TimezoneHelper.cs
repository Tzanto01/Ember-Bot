namespace Ember.Bot.Services;

public static class TimezoneHelper
{
    /// <summary>
    /// Tries to find a TimeZoneInfo from an IANA or Windows timezone id.
    /// Returns null if not found.
    /// </summary>
    public static TimeZoneInfo? Find(string tzId)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(tzId); }
        catch { return null; }
    }

    /// <summary>
    /// The day Ember switched from UTC days to each user's local day. Logs from before
    /// were dated in UTC, so a user far from UTC can see one artificial gap around it;
    /// a gap on this date is treated as covered (like a paused day) so no streak breaks.
    /// </summary>
    public static readonly DateOnly SwitchoverDate = new(2026, 10, 20);

    /// <summary>
    /// The current time in the user's timezone (IANA or Windows id).
    /// Unknown or missing ids fall back to UTC.
    /// </summary>
    public static DateTimeOffset LocalNow(string? timezoneId, TimeProvider time)
        => TimeZoneInfo.ConvertTime(time.GetUtcNow(), Find(timezoneId ?? "UTC") ?? TimeZoneInfo.Utc);

    /// <summary>
    /// The user's current local calendar day. Every "today", streak and weekly
    /// calculation for a user is based on this, never on the UTC date.
    /// </summary>
    public static DateOnly LocalToday(string? timezoneId, TimeProvider time)
        => DateOnly.FromDateTime(LocalNow(timezoneId, time).DateTime);

    /// <summary>
    /// Converts a local TimeOnly (in the user's timezone) to a UTC TimeOnly
    /// using today's date as context for DST accuracy.
    /// </summary>
    public static TimeOnly ToUtc(TimeOnly localTime, TimeZoneInfo tz)
    {
        var today = DateTime.UtcNow.Date;
        var localDt = today.Add(localTime.ToTimeSpan());
        var utcDt = TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(localDt, DateTimeKind.Unspecified), tz);
        return TimeOnly.FromDateTime(utcDt);
    }

    /// <summary>
    /// Converts a UTC TimeOnly to a local TimeOnly in the user's timezone.
    /// </summary>
    public static TimeOnly ToLocal(TimeOnly utcTime, TimeZoneInfo tz)
    {
        var today = DateTime.UtcNow.Date;
        var utcDt = DateTime.SpecifyKind(today.Add(utcTime.ToTimeSpan()), DateTimeKind.Utc);
        var localDt = TimeZoneInfo.ConvertTimeFromUtc(utcDt, tz);
        return TimeOnly.FromDateTime(localDt);
    }
}
