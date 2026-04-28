using Ember.Bot.Services;
using FluentAssertions;

namespace Ember.Tests;

public class ReminderSchedulerTests
{
    // ── BuildCron ─────────────────────────────────────────────────────────────

    [Fact]
    public void BuildCron_MidnightUtc_ProducesCorrectExpression()
    {
        var cron = ReminderScheduler.BuildCron(new TimeOnly(0, 0));
        cron.Should().Be("0 0 0 * * ?");
    }

    [Fact]
    public void BuildCron_NineAm_ProducesCorrectExpression()
    {
        var cron = ReminderScheduler.BuildCron(new TimeOnly(9, 0));
        cron.Should().Be("0 0 9 * * ?");
    }

    [Fact]
    public void BuildCron_ArbitraryTime_ProducesCorrectExpression()
    {
        var cron = ReminderScheduler.BuildCron(new TimeOnly(14, 35));
        cron.Should().Be("0 35 14 * * ?");
    }

    [Fact]
    public void BuildCron_LastMinuteOfDay_ProducesCorrectExpression()
    {
        var cron = ReminderScheduler.BuildCron(new TimeOnly(23, 59));
        cron.Should().Be("0 59 23 * * ?");
    }

    // ── Timezone conversion feeds into cron correctly ─────────────────────────

    [Fact]
    public void BuildCron_TokyoNineAm_ProducesUtcMidnightCron()
    {
        // Tokyo is UTC+9, no DST. 09:00 local = 00:00 UTC
        var tokyo    = TimeZoneInfo.FindSystemTimeZoneById("Asia/Tokyo");
        var utcTime  = TimezoneHelper.ToUtc(new TimeOnly(9, 0), tokyo);
        var cron     = ReminderScheduler.BuildCron(utcTime);
        cron.Should().Be("0 0 0 * * ?");
    }
}
