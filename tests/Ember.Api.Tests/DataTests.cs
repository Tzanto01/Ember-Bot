using System.Net;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class DataTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    [DockerFact]
    public async Task Another_users_habit_id_is_a_404_on_every_habit_route_and_changes_nothing()
    {
        var a = await Host.SignedInAsync();
        var b = await Host.SignedInAsync();
        var name = $"A-secret-{Guid.NewGuid():N}";
        var id = (await a.CreateHabitAsync(name)).GetProperty("id").GetInt32();
        var today = Host.Today.Iso();
        await (await a.Put($"/api/habits/{id}/days/{today}", new { completed = true })).ExpectJson();
        await (await a.Put($"/api/low-days/{today}")).Expect(HttpStatusCode.NoContent);

        var attempts = new (HttpMethod Method, string Url, object? Body)[]
        {
            (HttpMethod.Get, $"/api/habits/{id}", null),
            (HttpMethod.Patch, $"/api/habits/{id}", new { name = "hacked" }),
            (HttpMethod.Delete, $"/api/habits/{id}", null),
            (HttpMethod.Post, $"/api/habits/{id}/pause", new { until = "2026-11-10" }),
            (HttpMethod.Get, $"/api/habits/{id}/days", null),
            (HttpMethod.Put, $"/api/habits/{id}/days/{today}", new { completed = false }),
            (HttpMethod.Delete, $"/api/habits/{id}/days/{today}", null),
        };
        foreach (var (method, url, body) in attempts)
            await (await b.Send(method, url, body)).ExpectProblem(HttpStatusCode.NotFound, "not_found");

        var habit = await (await a.Get($"/api/habits/{id}")).ExpectJson();
        habit.GetProperty("name").GetString().Should().Be(name);
        habit.GetProperty("pausedUntil").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
        habit.GetProperty("today").GetProperty("state").GetString().Should().Be("lowday");
        habit.GetProperty("today").GetProperty("completed").GetBoolean().Should().BeTrue();
        (await Host.Db(db => db.HabitLogs.CountAsync(l => l.HabitId == id && l.Completed))).Should().Be(1);

        (await (await b.Get("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(0);
        (await (await b.Get("/api/low-days")).ExpectJson()).GetArrayLength().Should().Be(0);
        (await (await a.Get("/api/low-days")).ExpectJson()).GetArrayLength().Should().Be(1);
        var export = await (await b.Get("/api/me/export?format=json")).Expect(HttpStatusCode.OK);
        export.Should().NotContain(name).And.NotContain(a.Email);
        (await (await b.Get("/api/stats/weekly")).Expect(HttpStatusCode.OK)).Should().NotContain(name);
    }

    [DockerFact]
    public async Task Without_consent_habit_and_low_day_writes_are_refused_while_account_routes_still_work()
    {
        var user = await Host.SignedInAsync(consent: false);
        var today = Host.Today.Iso();

        await (await user.Post("/api/habits", new { name = "Water", frequency = "daily" })).ExpectProblem(HttpStatusCode.Forbidden, "consent_required");
        await (await user.Put($"/api/low-days/{today}")).ExpectProblem(HttpStatusCode.Forbidden, "consent_required");

        var me = await (await user.Get("/api/me")).ExpectJson();
        me.GetProperty("consent").GetProperty("given").GetBoolean().Should().BeFalse();
        (await (await user.Get("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(0);
        var patched = await (await user.Patch("/api/me", new { graceDaysPerWeek = 2 })).ExpectJson();
        patched.GetProperty("graceDaysPerWeek").GetInt32().Should().Be(2);
        await (await user.Get("/api/me/export?format=csv")).Expect(HttpStatusCode.OK);
        await (await user.Post("/api/me/delete", new DeleteRequest(ApiClient.Passphrase, "DELETE"))).Expect(HttpStatusCode.NoContent);
    }

    [DockerFact]
    public async Task Consent_is_accepted_only_for_the_current_policy_version_and_then_unlocks_habits()
    {
        var user = await Host.SignedInAsync(consent: false);

        await (await user.Post("/api/me/consent", new { policyVersion = "1999-01" })).ExpectProblem(HttpStatusCode.BadRequest, "validation");
        await (await user.Post("/api/habits", new { name = "Water", frequency = "daily" })).ExpectProblem(HttpStatusCode.Forbidden, "consent_required");

        await user.GiveConsentAsync();

        var me = await (await user.Get("/api/me")).ExpectJson();
        me.GetProperty("consent").GetProperty("given").GetBoolean().Should().BeTrue();
        await user.CreateHabitAsync();
    }

    [DockerFact]
    public async Task Creating_a_habit_returns_201_with_the_contract_shape_and_trims_the_name()
    {
        var user = await Host.SignedInAsync();

        var response = await user.Post("/api/habits", new { name = "  Water  ", frequency = "daily", reminderTime = "09:00" });

        var habit = await response.ExpectJson(HttpStatusCode.Created);
        response.Headers.Location!.OriginalString.Should().Be($"/api/habits/{habit.GetProperty("id").GetInt32()}");
        habit.GetProperty("name").GetString().Should().Be("Water");
        habit.GetProperty("frequency").GetString().Should().Be("daily");
        habit.GetProperty("reminderTime").GetString().Should().Be("09:00");
        habit.GetProperty("startDate").GetString().Should().Be(Host.Today.Iso());
        habit.GetProperty("today").GetProperty("state").GetString().Should().Be("pending");
        habit.GetProperty("stats").GetProperty("streak").GetInt32().Should().Be(0);
        habit.GetProperty("reminderChannels").EnumerateArray().Select(c => c.GetString()).Should().Equal("webpush");
        (await (await user.Get("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(1);
    }

    [DockerFact]
    public async Task Checking_in_today_marks_the_day_done_counts_the_streak_and_clearing_undoes_it()
    {
        var user = await Host.SignedInAsync();
        var id = (await user.CreateHabitAsync()).GetProperty("id").GetInt32();
        var today = Host.Today.Iso();

        var done = await (await user.Put($"/api/habits/{id}/days/{today}", new { completed = true })).ExpectJson();

        done.GetProperty("today").GetProperty("state").GetString().Should().Be("done");
        done.GetProperty("stats").GetProperty("streak").GetInt32().Should().Be(1);
        var days = await (await user.Get($"/api/habits/{id}/days?from={today}&to={today}")).ExpectJson();
        days.GetArrayLength().Should().Be(1);
        days[0].GetProperty("state").GetString().Should().Be("done");
        days[0].GetProperty("completed").GetBoolean().Should().BeTrue();

        var cleared = await (await user.Delete($"/api/habits/{id}/days/{today}")).ExpectJson();
        cleared.GetProperty("today").GetProperty("state").GetString().Should().Be("pending");
        (await Host.Db(db => db.HabitLogs.CountAsync(l => l.HabitId == id))).Should().Be(0);
    }

    [DockerFact]
    public async Task Days_outside_the_editable_range_are_422_and_write_nothing()
    {
        var user = await Host.SignedInAsync();
        var id = (await user.CreateHabitAsync()).GetProperty("id").GetInt32();
        var tomorrow = Host.Today.AddDays(1).Iso();
        var yesterday = Host.Today.AddDays(-1).Iso();

        await (await user.Put($"/api/habits/{id}/days/{tomorrow}", new { completed = true })).ExpectProblem((HttpStatusCode)422, "in_future");
        await (await user.Put($"/api/habits/{id}/days/{yesterday}", new { completed = true })).ExpectProblem((HttpStatusCode)422, "before_habit_start");
        await (await user.Put($"/api/low-days/{tomorrow}")).ExpectProblem((HttpStatusCode)422, "in_future");
        await (await user.Put($"/api/low-days/{yesterday}")).ExpectProblem((HttpStatusCode)422, "before_habit_start");

        (await Host.Db(db => db.HabitLogs.CountAsync(l => l.HabitId == id))).Should().Be(0);
        (await Host.Db(db => db.DayMarks.CountAsync())).Should().Be(0);
    }

    [DockerFact]
    public async Task The_26th_habit_is_a_409_habit_limit()
    {
        var user = await Host.SignedInAsync();
        for (var i = 0; i < 25; i++)
            await user.CreateHabitAsync();

        await (await user.Post("/api/habits", new { name = "One too many", frequency = "daily" })).ExpectProblem(HttpStatusCode.Conflict, "habit_limit");

        (await (await user.Get("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(25);
    }

    [DockerFact]
    public async Task Patching_with_one_invalid_field_writes_nothing_and_a_valid_patch_applies()
    {
        var user = await Host.SignedInAsync();
        var id = (await user.CreateHabitAsync("Water")).GetProperty("id").GetInt32();

        var problem = await (await user.Patch($"/api/habits/{id}", new { name = "Renamed", reminderTime = "25:99" })).ExpectProblem(HttpStatusCode.BadRequest, "validation");

        problem.GetProperty("errors").Has("reminderTime").Should().BeTrue();
        var unchanged = await (await user.Get($"/api/habits/{id}")).ExpectJson();
        unchanged.GetProperty("name").GetString().Should().Be("Water");
        var renamed = await (await user.Patch($"/api/habits/{id}", new { name = "Renamed", reminderTime = "07:30" })).ExpectJson();
        renamed.GetProperty("name").GetString().Should().Be("Renamed");
        renamed.GetProperty("reminderTime").GetString().Should().Be("07:30");
    }
}
