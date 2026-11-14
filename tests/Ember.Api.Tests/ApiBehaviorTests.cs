using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class ApiBehaviorTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private Task<DateTime?> NextReminder(int habitId) => Host.Db(db => db.Habits.Where(h => h.Id == habitId).Select(h => h.NextReminderUtc).SingleAsync());

    [DockerFact]
    public async Task Patching_me_with_an_invalid_zone_or_grace_value_is_a_400_and_writes_nothing()
    {
        var user = await Host.SignedInAsync();

        var windows = await (await user.Patch("/api/me", new { timezone = "W. Europe Standard Time", graceDaysPerWeek = 2 })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var grace = await (await user.Patch("/api/me", new { graceDaysPerWeek = 4 })).ExpectProblem(HttpStatusCode.BadRequest, "validation");

        windows.GetProperty("errors").Has("timezone").Should().BeTrue();
        grace.GetProperty("errors").Has("graceDaysPerWeek").Should().BeTrue();
        var me = await (await user.Get("/api/me")).ExpectJson();
        me.GetProperty("timezone").GetString().Should().Be("UTC");
        me.GetProperty("timezoneSet").GetBoolean().Should().BeFalse();
        me.GetProperty("graceDaysPerWeek").GetInt32().Should().Be(1);
    }

    [DockerFact]
    public async Task Patching_me_with_a_theme_stores_it_and_a_patch_without_theme_keeps_it()
    {
        var user = await Host.SignedInAsync();
        (await (await user.Get("/api/me")).ExpectJson()).GetProperty("theme").ValueKind.Should().Be(JsonValueKind.Null);

        var patched = await (await user.Patch("/api/me", new { theme = "tidepool" })).ExpectJson();
        await (await user.Patch("/api/me", new { graceDaysPerWeek = 2 })).ExpectJson();

        patched.GetProperty("theme").GetString().Should().Be("tidepool");
        (await (await user.Get("/api/me")).ExpectJson()).GetProperty("theme").GetString().Should().Be("tidepool");
    }

    [DockerFact]
    public async Task Patching_me_with_the_removed_leaderboard_field_is_accepted_and_ignored()
    {
        var user = await Host.SignedInAsync();

        var patched = await (await user.Patch("/api/me", new { graceDaysPerWeek = 2, leaderboardOptIn = true })).ExpectJson();

        patched.GetProperty("graceDaysPerWeek").GetInt32().Should().Be(2);
        patched.TryGetProperty("leaderboardOptIn", out _).Should().BeFalse();
    }

    [DockerFact]
    public async Task Patching_me_with_an_unknown_theme_is_a_400_and_keeps_the_stored_theme()
    {
        var user = await Host.SignedInAsync();
        await (await user.Patch("/api/me", new { theme = "marigold" })).ExpectJson();

        var problem = await (await user.Patch("/api/me", new { theme = "hearth", graceDaysPerWeek = 2 })).ExpectProblem(HttpStatusCode.BadRequest, "validation");

        problem.GetProperty("errors").Has("theme").Should().BeTrue();
        var me = await (await user.Get("/api/me")).ExpectJson();
        me.GetProperty("theme").GetString().Should().Be("marigold");
        me.GetProperty("graceDaysPerWeek").GetInt32().Should().Be(1);
    }

    [DockerFact]
    public async Task Patching_me_with_an_iana_zone_stores_it_and_reschedules_existing_reminders_into_it()
    {
        var user = await Host.SignedInAsync();
        var id = (await (await user.Post("/api/habits", new { name = "Water", frequency = "daily", reminderTime = "09:00" })).ExpectJson(HttpStatusCode.Created))
            .GetProperty("id").GetInt32();
        (await NextReminder(id)).Should().Be(new DateTime(2026, 11, 2, 9, 0, 0, DateTimeKind.Utc));

        var me = await (await user.Patch("/api/me", new { timezone = "Asia/Tokyo" })).ExpectJson();

        me.GetProperty("timezone").GetString().Should().Be("Asia/Tokyo");
        me.GetProperty("timezoneSet").GetBoolean().Should().BeTrue();
        (await NextReminder(id)).Should().Be(new DateTime(2026, 11, 2, 0, 0, 0, DateTimeKind.Utc));
    }

    [DockerFact]
    public async Task Habit_days_default_to_the_14_days_ending_today_and_reject_bad_ranges()
    {
        var user = await Host.SignedInAsync();
        var id = (await user.CreateHabitAsync()).GetProperty("id").GetInt32();
        var today = Host.Today;
        string Url(DateOnly from, DateOnly to) => $"/api/habits/{id}/days?from={from.Iso()}&to={to.Iso()}";

        var days = await (await user.Get($"/api/habits/{id}/days")).ExpectJson();
        var longest = await (await user.Get(Url(today.AddDays(-365), today))).ExpectJson();

        days.EnumerateArray().Select(d => d.GetProperty("date").GetString()).Should()
            .Equal(Enumerable.Range(-13, 14).Select(offset => today.AddDays(offset).Iso()));
        days[0].GetProperty("state").GetString().Should().Be("beforestart");
        days[13].GetProperty("state").GetString().Should().Be("pending");
        longest.GetArrayLength().Should().Be(366);
        await (await user.Get(Url(today.AddDays(-366), today))).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        await (await user.Get(Url(today, today.AddDays(-1)))).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        await (await user.Get(Url(today, today.AddDays(1)))).ExpectProblem(HttpStatusCode.BadRequest, "validation");
    }

    [DockerFact]
    public async Task Pausing_validates_the_date_marks_today_paused_and_null_resumes()
    {
        var user = await Host.SignedInAsync();
        var id = (await user.CreateHabitAsync()).GetProperty("id").GetInt32();
        var until = Host.Today.AddDays(3);

        await (await user.Post($"/api/habits/{id}/pause", new { until = Host.Today.AddDays(-1).Iso() })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var paused = await (await user.Post($"/api/habits/{id}/pause", new { until = until.Iso() })).ExpectJson();

        paused.GetProperty("pausedToday").GetBoolean().Should().BeTrue();
        paused.GetProperty("pausedUntil").GetString().Should().Be(until.Iso());
        paused.GetProperty("today").GetProperty("state").GetString().Should().Be("paused");

        var resumed = await (await user.Post($"/api/habits/{id}/pause", new { until = (string?)null })).ExpectJson();

        resumed.GetProperty("pausedToday").GetBoolean().Should().BeFalse();
        resumed.GetProperty("pausedUntil").ValueKind.Should().Be(JsonValueKind.Null);
        resumed.GetProperty("today").GetProperty("state").GetString().Should().Be("pending");
    }

    [DockerFact]
    public async Task Weekly_stats_have_no_headline_for_a_week_with_nothing_possible()
    {
        var user = await Host.SignedInAsync();
        await user.CreateHabitAsync();

        var stats = await (await user.Get("/api/stats/weekly")).ExpectJson();

        stats.GetProperty("totalPossible").GetInt32().Should().Be(0);
        stats.GetProperty("headline").GetString().Should().BeEmpty();
        stats.GetProperty("footer").GetString().Should().BeEmpty();
    }

    [DockerFact]
    public async Task Weekly_stats_report_both_habit_kinds_with_a_plain_text_headline()
    {
        var user = await Host.SignedInAsync();
        var daily = (await user.CreateHabitAsync("Daily")).GetProperty("id").GetInt32();
        var weekly = (await (await user.Post("/api/habits", new { name = "Weekly", frequency = "weekly", weeklyTarget = 3 })).ExpectJson(HttpStatusCode.Created))
            .GetProperty("id").GetInt32();
        Host.Time.Advance(TimeSpan.FromDays(3));
        await (await user.Put($"/api/habits/{daily}/days/{Host.Today.AddDays(-2).Iso()}", new { completed = true })).ExpectJson();

        var stats = await (await user.Get("/api/stats/weekly")).ExpectJson();

        stats.GetProperty("totalDone").GetInt32().Should().Be(1);
        stats.GetProperty("totalPossible").GetInt32().Should().Be(4);
        var headline = stats.GetProperty("headline").GetString()!;
        headline.Should().Contain("1 check-in").And.NotContain("**");
        stats.GetProperty("footer").GetString().Should().NotBeNullOrEmpty();
        var habits = stats.GetProperty("habits").EnumerateArray().ToDictionary(h => h.GetProperty("habitId").GetInt32());
        habits[daily].GetProperty("done").GetInt32().Should().Be(1);
        habits[daily].GetProperty("possible").GetInt32().Should().Be(2);
        habits[daily].GetProperty("streak").ValueKind.Should().Be(JsonValueKind.Number);
        habits[weekly].GetProperty("possible").GetInt32().Should().Be(2);
        habits[weekly].GetProperty("streak").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [DockerFact]
    public async Task Habit_templates_list_the_core_templates_without_signing_in()
    {
        var templates = await (await Host.NewClient().Get("/api/habit-templates")).ExpectJson();

        templates.EnumerateArray().Select(t => t.GetProperty("key").GetString()).Should().Equal(HabitTemplates.All.Select(t => t.Key));
        foreach (var template in templates.EnumerateArray())
        {
            Regex.IsMatch(template.GetProperty("suggestedReminderTime").GetString()!, @"^\d{2}:\d{2}$").Should().BeTrue();
            var daily = template.GetProperty("frequency").GetString() == "daily";
            (template.GetProperty("weeklyTarget").ValueKind == JsonValueKind.Null).Should().Be(daily);
        }
        templates[0].GetProperty("suggestedReminderTime").GetString().Should().Be("08:00");
    }

    [DockerFact]
    public async Task Health_is_200_the_vapid_key_is_501_until_configured_and_push_subscriptions_need_a_session()
    {
        await (await Host.NewClient().Get("/health")).Expect(HttpStatusCode.OK);
        (await Host.NewClient().Get("/api/push/vapid-public-key")).StatusCode.Should().Be(HttpStatusCode.NotImplemented);
        (await Host.NewClient().Post("/api/me/push-subscriptions",
            new { endpoint = "https://fcm.googleapis.com/fcm/send/x", keys = new { p256dh = "AA", auth = "AA" } })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await Host.NewClient().Delete("/api/me/push-subscriptions?endpoint=https%3A%2F%2Ffcm.googleapis.com%2Fx")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [DockerFact]
    public async Task Export_includes_the_account_email_and_discord_id_in_json_and_csv()
    {
        var user = await Host.SignedInAsync();
        var discordId = ApiHost.NewDiscordId();
        await Host.DiscordAsync(user, "/api/auth/discord/link", discordId);

        var json = await (await user.Get("/api/me/export?format=json")).ExpectJson();
        var csv = await (await user.Get("/api/me/export?format=csv")).Expect(HttpStatusCode.OK);

        var account = json.GetProperty("account");
        account.GetProperty("email").GetString().Should().Be(user.Email);
        account.GetProperty("discord_id").GetString().Should().Be(discordId.ToString());
        csv.Split('\n')[0].Trim().Should().Contain(",email,discord_id,");
        csv.Should().Contain(user.Email).And.Contain(discordId.ToString());
    }

    [DockerFact]
    public async Task Export_includes_the_theme_in_json_and_csv()
    {
        var user = await Host.SignedInAsync();
        await (await user.Patch("/api/me", new { theme = "fieldnotes" })).ExpectJson();

        var json = await (await user.Get("/api/me/export?format=json")).ExpectJson();
        var csv = await (await user.Get("/api/me/export?format=csv")).Expect(HttpStatusCode.OK);

        json.GetProperty("settings").GetProperty("theme").GetString().Should().Be("fieldnotes");
        var lines = csv.Split("\r\n");
        var column = Array.IndexOf(lines[0].Split(','), "theme");
        column.Should().BePositive();
        lines.Single(l => l.StartsWith("settings,")).Split(',')[column].Should().Be("fieldnotes");
    }

    [DockerFact]
    public async Task Patching_me_with_a_second_reminder_choice_stores_it_and_any_other_value_is_a_400()
    {
        var user = await Host.SignedInAsync();
        (await (await user.Get("/api/me")).ExpectJson()).GetProperty("secondReminderMinutes").GetInt32().Should().Be(0);

        var patched = await (await user.Patch("/api/me", new { secondReminderMinutes = 30 })).ExpectJson();
        var problem = await (await user.Patch("/api/me", new { secondReminderMinutes = 45, graceDaysPerWeek = 2 })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var kept = await (await user.Patch("/api/me", new { theme = "tidepool" })).ExpectJson();

        patched.GetProperty("secondReminderMinutes").GetInt32().Should().Be(30);
        problem.GetProperty("errors").Has("secondReminderMinutes").Should().BeTrue();
        kept.GetProperty("secondReminderMinutes").GetInt32().Should().Be(30);
        kept.GetProperty("graceDaysPerWeek").GetInt32().Should().Be(1);
    }

    [DockerFact]
    public async Task A_new_account_starts_with_streaks_off_and_patching_me_turns_them_on_and_off_and_only_takes_a_bool()
    {
        var user = await Host.SignedInAsync();
        (await (await user.Get("/api/me")).ExpectJson()).GetProperty("showStreaks").GetBoolean().Should().BeFalse();

        var on = await (await user.Patch("/api/me", new { showStreaks = true })).ExpectJson();
        var kept = await (await user.Patch("/api/me", new { theme = "tidepool" })).ExpectJson();
        var word = await (await user.Patch("/api/me", new { showStreaks = "yes" })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var number = await (await user.Patch("/api/me", new { showStreaks = 1 })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var off = await (await user.Patch("/api/me", new { showStreaks = false })).ExpectJson();

        on.GetProperty("showStreaks").GetBoolean().Should().BeTrue();
        kept.GetProperty("showStreaks").GetBoolean().Should().BeTrue();
        word.GetProperty("errors").Has("showStreaks").Should().BeTrue();
        number.GetProperty("errors").Has("showStreaks").Should().BeTrue();
        off.GetProperty("showStreaks").GetBoolean().Should().BeFalse();
    }

    [DockerFact]
    public async Task Patching_me_sets_the_language_to_en_or_de_only()
    {
        var user = await Host.SignedInAsync();
        (await (await user.Get("/api/me")).ExpectJson()).GetProperty("language").GetString().Should().Be("en");

        var german = await (await user.Patch("/api/me", new { language = "de" })).ExpectJson();
        var kept = await (await user.Patch("/api/me", new { theme = "tidepool" })).ExpectJson();
        var french = await (await user.Patch("/api/me", new { language = "fr" })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var number = await (await user.Patch("/api/me", new { language = 1 })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var english = await (await user.Patch("/api/me", new { language = "en" })).ExpectJson();

        german.GetProperty("language").GetString().Should().Be("de");
        kept.GetProperty("language").GetString().Should().Be("de");
        french.GetProperty("errors").Has("language").Should().BeTrue();
        number.GetProperty("errors").Has("language").Should().BeTrue();
        english.GetProperty("language").GetString().Should().Be("en");
    }

    [DockerFact]
    public async Task Calm_mode_starts_off_and_patching_me_turns_it_on_and_off_and_only_takes_a_bool()
    {
        var user = await Host.SignedInAsync();
        (await (await user.Get("/api/me")).ExpectJson()).GetProperty("calmMode").GetBoolean().Should().BeFalse();

        var on = await (await user.Patch("/api/me", new { calmMode = true })).ExpectJson();
        var kept = await (await user.Patch("/api/me", new { theme = "tidepool" })).ExpectJson();
        var word = await (await user.Patch("/api/me", new { calmMode = "yes" })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        var off = await (await user.Patch("/api/me", new { calmMode = false })).ExpectJson();

        on.GetProperty("calmMode").GetBoolean().Should().BeTrue();
        kept.GetProperty("calmMode").GetBoolean().Should().BeTrue();
        word.GetProperty("errors").Has("calmMode").Should().BeTrue();
        off.GetProperty("calmMode").GetBoolean().Should().BeFalse();
    }

    private static async Task<string[]> TipsSeenAsync(ApiClient user)
        => (await (await user.Get("/api/me")).ExpectJson()).GetProperty("tipsSeen").EnumerateArray().Select(e => e.GetString()!).ToArray();

    [DockerFact]
    public async Task A_new_account_has_seen_no_tips_and_marking_one_without_consent_adds_it_once()
    {
        var user = await Host.SignedInAsync(consent: false);
        (await TipsSeenAsync(user)).Should().BeEmpty();

        await (await user.Put("/api/me/tips/routines")).Expect(HttpStatusCode.NoContent);
        await (await user.Put("/api/me/tips/routines")).Expect(HttpStatusCode.NoContent);
        var unknown = await (await user.Put("/api/me/tips/leaderboard")).ExpectProblem(HttpStatusCode.BadRequest, "validation");

        (await TipsSeenAsync(user)).Should().Equal("routines");
        unknown.GetProperty("errors").Has("id").Should().BeTrue();
    }

    [DockerFact]
    public async Task Choosing_streaks_either_way_marks_the_streaks_tip_seen()
    {
        var user = await Host.SignedInAsync();
        await (await user.Put("/api/me/tips/android")).Expect(HttpStatusCode.NoContent);

        var me = await (await user.Patch("/api/me", new { showStreaks = false })).ExpectJson();

        me.GetProperty("tipsSeen").EnumerateArray().Select(e => e.GetString()).Should().Equal("android", "streaks");
        var userId = await user.IdAsync();
        (await Host.Service(s => s.NeedsStreaksQuestionAsync(userId))).Should().BeFalse();
    }

    [DockerFact]
    public async Task The_bot_asks_the_streaks_question_only_while_streaks_are_off_and_the_tip_is_unseen()
    {
        var fresh = await Host.SignedInAsync();
        var freshId = await fresh.IdAsync();
        var streaksOn = await Host.SignedInAsync();
        var streaksOnId = await streaksOn.IdAsync();
        await Host.Db(db => db.Users.Where(u => u.Id == streaksOnId).ExecuteUpdateAsync(s => s.SetProperty(u => u.ShowStreaks, true)));

        (await Host.Service(s => s.NeedsStreaksQuestionAsync(freshId))).Should().BeTrue();
        (await Host.Service(s => s.NeedsStreaksQuestionAsync(streaksOnId))).Should().BeFalse();
        (await Host.Service(s => s.NeedsStreaksQuestionAsync(Guid.NewGuid()))).Should().BeFalse();
    }
}
