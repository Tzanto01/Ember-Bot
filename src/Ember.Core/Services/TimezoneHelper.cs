namespace Ember.Core.Services;

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
    public static readonly DateOnly SwitchoverDate = new(2026, 10, 11);

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
    /// using <paramref name="onDate"/> (default: today in UTC) as context for DST accuracy.
    /// </summary>
    public static TimeOnly ToUtc(TimeOnly localTime, TimeZoneInfo tz, DateOnly? onDate = null)
    {
        var date = onDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        return TimeOnly.FromDateTime(LocalToUtc(date.ToDateTime(localTime), tz));
    }

    /// <summary>
    /// The first UTC instant strictly after <paramref name="afterUtc"/> at which the wall clock
    /// in <paramref name="tz"/> shows <paramref name="localTime"/>. A time inside a spring-forward
    /// gap moves to the first valid local time after the gap; an ambiguous fall-back time uses
    /// its first occurrence (the earlier UTC instant).
    /// </summary>
    public static DateTime NextOccurrenceUtc(TimeOnly localTime, TimeZoneInfo tz, DateTime afterUtc)
    {
        afterUtc = DateTime.SpecifyKind(afterUtc, DateTimeKind.Utc);
        var day = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(afterUtc, tz)).AddDays(-1);
        while (true)
        {
            var candidate = LocalToUtc(day.ToDateTime(localTime), tz);
            if (candidate > afterUtc) return candidate;
            day = day.AddDays(1);
        }
    }

    private static DateTime LocalToUtc(DateTime local, TimeZoneInfo tz)
    {
        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        while (tz.IsInvalidTime(local))
            local = local.AddMinutes(1);

        if (tz.IsAmbiguousTime(local))
            return DateTime.SpecifyKind(local - tz.GetAmbiguousTimeOffsets(local).Max(), DateTimeKind.Utc);

        return TimeZoneInfo.ConvertTimeToUtc(local, tz);
    }
}
