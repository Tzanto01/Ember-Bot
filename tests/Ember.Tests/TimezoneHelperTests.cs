using Ember.Bot.Services;
using FluentAssertions;

namespace Ember.Tests;

public class TimezoneHelperTests
{
    private static readonly TimeZoneInfo Amsterdam =
        TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam");

    private static readonly TimeZoneInfo NewYork =
        TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    private static readonly TimeZoneInfo Tokyo =
        TimeZoneInfo.FindSystemTimeZoneById("Asia/Tokyo");

    // ── Find ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Find_ValidIanaId_ReturnsTimeZoneInfo()
    {
        TimezoneHelper.Find("Europe/Amsterdam").Should().NotBeNull();
    }

    [Fact]
    public void Find_InvalidId_ReturnsNull()
    {
        TimezoneHelper.Find("Not/ATimezone").Should().BeNull();
    }

    // ── ToUtc ─────────────────────────────────────────────────────────────────

    [Fact]
    public void ToUtc_UtcTimezone_ReturnsSameTime()
    {
        var time = new TimeOnly(10, 0);
        TimezoneHelper.ToUtc(time, TimeZoneInfo.Utc).Should().Be(time);
    }

    [Fact]
    public void ToUtc_AmsterdamSummerTime_SubtractsTwoHours()
    {
        // Amsterdam is UTC+2 in summer (CEST)
        // This test is date-dependent for DST, so we compute expected dynamically
        var localTime = new TimeOnly(10, 0);
        var utcTime   = TimezoneHelper.ToUtc(localTime, Amsterdam);

        var today    = DateTime.UtcNow.Date;
        var localDt  = DateTime.SpecifyKind(today.Add(localTime.ToTimeSpan()), DateTimeKind.Unspecified);
        var expected = TimeOnly.FromDateTime(TimeZoneInfo.ConvertTimeToUtc(localDt, Amsterdam));

        utcTime.Should().Be(expected);
    }

    [Fact]
    public void ToUtc_NewYork_ConvertsCorrectly()
    {
        var localTime = new TimeOnly(9, 30);
        var utcTime   = TimezoneHelper.ToUtc(localTime, NewYork);

        var today    = DateTime.UtcNow.Date;
        var localDt  = DateTime.SpecifyKind(today.Add(localTime.ToTimeSpan()), DateTimeKind.Unspecified);
        var expected = TimeOnly.FromDateTime(TimeZoneInfo.ConvertTimeToUtc(localDt, NewYork));

        utcTime.Should().Be(expected);
    }

    [Fact]
    public void ToUtc_Tokyo_ConvertsCorrectly()
    {
        // Tokyo is UTC+9, no DST
        var localTime = new TimeOnly(18, 0);
        var utcTime   = TimezoneHelper.ToUtc(localTime, Tokyo);
        var expected  = new TimeOnly(9, 0);
        utcTime.Should().Be(expected);
    }

    // ── ToLocal ───────────────────────────────────────────────────────────────

    [Fact]
    public void ToLocal_UtcTimezone_ReturnsSameTime()
    {
        var time = new TimeOnly(14, 0);
        TimezoneHelper.ToLocal(time, TimeZoneInfo.Utc).Should().Be(time);
    }

    [Fact]
    public void ToLocal_Tokyo_AddsNineHours()
    {
        // Tokyo is UTC+9, no DST
        var utcTime   = new TimeOnly(9, 0);
        var localTime = TimezoneHelper.ToLocal(utcTime, Tokyo);
        localTime.Should().Be(new TimeOnly(18, 0));
    }

    [Fact]
    public void ToLocal_IsInverseOfToUtc()
    {
        var original  = new TimeOnly(15, 45);
        var utc       = TimezoneHelper.ToUtc(original, Amsterdam);
        var roundTrip = TimezoneHelper.ToLocal(utc, Amsterdam);
        roundTrip.Should().Be(original);
    }

    [Fact]
    public void ToUtc_IsInverseOfToLocal()
    {
        var original  = new TimeOnly(8, 0);
        var local     = TimezoneHelper.ToLocal(original, NewYork);
        var roundTrip = TimezoneHelper.ToUtc(local, NewYork);
        roundTrip.Should().Be(original);
    }
}
