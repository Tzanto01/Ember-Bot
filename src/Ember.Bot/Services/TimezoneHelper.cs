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
