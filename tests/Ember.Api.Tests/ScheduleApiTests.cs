using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

/// <summary>Weekdays schedules, times per day and the day stats (contract "Features v1.6").</summary>
[Collection("Postgres")]
public class ScheduleApiTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private static async Task ExpectFieldError(HttpResponseMessage response, string field)
    {
        var problem = await response.ExpectProblem(HttpStatusCode.BadRequest, "validation");
        problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).Should().Equal(field);
    }

    [DockerFact]
    public async Task Create_and_patch_validate_days_and_times_per_day_and_merge_with_the_current_schedule()
    {
        var user = await Host.SignedInAsync();

        await ExpectFieldError(await user.Post("/api/habits", new { name = "Gym", frequency = "weekdays" }), "days");
        await ExpectFieldError(await user.Post("/api/habits", new
        {
            name = "Gym",
            frequency = "weekdays",
            days = new[] { "mon", "tue", "wed", "thu", "fri", "sat", "sun" }
        }), "days");
        await ExpectFieldError(await user.Post("/api/habits", new { name = "Gym", frequency = "weekdays", days = new[] { "mon", "mon" } }), "days");
        await ExpectFieldError(await user.Post("/api/habits", new { name = "Gym", frequency = "daily", days = new[] { "mon" } }), "days");
        await ExpectFieldError(await user.Post("/api/habits", new { name = "Gym", frequency = "weekly", timesPerDay = 2 }), "timesPerDay");
        await ExpectFieldError(await user.Post("/api/habits", new { name = "Gym", frequency = "daily", timesPerDay = 11 }), "timesPerDay");
        (await Host.Db(db => db.Habits.CountAsync(h => h.User.Email == user.Email))).Should().Be(0);

        var created = await (await user.Post("/api/habits", new { name = "Gym", frequency = "weekdays", days = new[] { "fri", "mon" }, timesPerDay = 2 }))
            .ExpectJson(HttpStatusCode.Created);
        created.GetProperty("frequency").GetString().Should().Be("weekdays");
        created.GetProperty("days").EnumerateArray().Select(d => d.GetString()).Should().Equal("mon", "fri");
        created.GetProperty("timesPerDay").GetInt32().Should().Be(2);
        created.GetProperty("stats").GetProperty("streak").ValueKind.Should().Be(JsonValueKind.Number);
        created.GetProperty("stats").GetProperty("week").ValueKind.Should().Be(JsonValueKind.Null);
        var id = created.GetProperty("id").GetInt32();

        var patched = await (await user.Patch($"/api/habits/{id}", new { days = new[] { "wed" } })).ExpectJson();
        patched.GetProperty("days").EnumerateArray().Select(d => d.GetString()).Should().Equal("wed");
        patched.GetProperty("timesPerDay").GetInt32().Should().Be(2);

        await ExpectFieldError(await user.Patch($"/api/habits/{id}", new { frequency = "weekly", timesPerDay = 2, name = "Renamed" }), "timesPerDay");
        var weekly = await (await user.Patch($"/api/habits/{id}", new { frequency = "weekly" })).ExpectJson();
        weekly.GetProperty("timesPerDay").GetInt32().Should().Be(1);
        weekly.GetProperty("days").ValueKind.Should().Be(JsonValueKind.Null);
        weekly.GetProperty("name").GetString().Should().Be("Gym");

        await ExpectFieldError(await user.Patch($"/api/habits/{id}", new { frequency = "weekdays" }), "days");
    }

    [DockerFact]
    public async Task Put_day_sets_an_absolute_count_and_rejects_bad_bodies()
    {
        var user = await Host.SignedInAsync();
        var id = (await (await user.Post("/api/habits", new { name = "Water", frequency = "daily", timesPerDay = 3 }))
            .ExpectJson(HttpStatusCode.Created)).GetProperty("id").GetInt32();
        var url = $"/api/habits/{id}/days/{Host.Today.Iso()}";

        var habit = await (await user.Put(url, new { count = 2 })).ExpectJson();
        var today = habit.GetProperty("today");
        today.GetProperty("state").GetString().Should().Be("partial");
        today.GetProperty("count").GetInt32().Should().Be(2);
        today.GetProperty("completed").ValueKind.Should().Be(JsonValueKind.Null);

        await ExpectFieldError(await user.Put(url, new { count = 4 }), "count");
        await ExpectFieldError(await user.Put(url, new { count = -1 }), "count");
        await ExpectFieldError(await user.Put(url, new { count = 1, completed = true }), "count");
        await ExpectFieldError(await user.Put(url, new { }), "completed");

        var done = await (await user.Put(url, new { count = 3 })).ExpectJson();
        done.GetProperty("today").GetProperty("state").GetString().Should().Be("done");
        done.GetProperty("today").GetProperty("completed").GetBoolean().Should().BeTrue();
    }

    [DockerFact]
    public async Task Stats_days_reports_each_day_oldest_first_and_validates_the_range()
    {
        var user = await Host.SignedInAsync();
        var today = Host.Today;
        var id = (await (await user.Post("/api/habits", new { name = "Water", frequency = "daily", timesPerDay = 2 }))
            .ExpectJson(HttpStatusCode.Created)).GetProperty("id").GetInt32();
        await (await user.Put($"/api/habits/{id}/days/{today.Iso()}", new { count = 1 })).ExpectJson();

        var days = await (await user.Get($"/api/stats/days?from={today.AddDays(-1).Iso()}&to={today.Iso()}")).ExpectJson();
        days.EnumerateArray().Select(d => (
                d.GetProperty("date").GetString(), d.GetProperty("scheduled").GetInt32(), d.GetProperty("done").GetInt32(),
                d.GetProperty("partial").GetInt32(), d.GetProperty("showedUp").GetBoolean()))
            .Should().Equal((today.AddDays(-1).Iso(), 0, 0, 0, false), (today.Iso(), 1, 0, 1, true));

        var year = await (await user.Get("/api/stats/days")).ExpectJson();
        year.GetArrayLength().Should().Be(366);
        year[365].GetProperty("date").GetString().Should().Be(today.Iso());

        await ExpectFieldError(await user.Get($"/api/stats/days?to={today.AddDays(1).Iso()}"), "to");
        await ExpectFieldError(await user.Get($"/api/stats/days?from={today.Iso()}&to={today.AddDays(-1).Iso()}"), "from");
        await ExpectFieldError(await user.Get($"/api/stats/days?from={today.AddDays(-366).Iso()}"), "from");
    }
}
