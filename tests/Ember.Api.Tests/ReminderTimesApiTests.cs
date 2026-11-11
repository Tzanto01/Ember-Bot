using System.Net;
using System.Text.Json;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

/// <summary>Several reminder times per habit (contract "Reminder times v1.12").</summary>
[Collection("Postgres")]
public class ReminderTimesApiTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private static async Task ExpectFieldError(HttpResponseMessage response, string field)
    {
        var problem = await response.ExpectProblem(HttpStatusCode.BadRequest, "validation");
        problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).Should().Equal(field);
    }

    private static List<string?> Times(JsonElement habit)
        => habit.GetProperty("reminderTimes").EnumerateArray().Select(t => t.GetString()).ToList();

    [DockerFact]
    public async Task Create_sorts_the_times_and_rejects_repeats_bad_values_and_more_times_than_times_per_day()
    {
        var user = await Host.SignedInAsync();

        await ExpectFieldError(await user.Post("/api/habits", new
        {
            name = "Water",
            frequency = "daily",
            timesPerDay = 2,
            reminderTimes = new[] { "08:00", "13:00", "20:00" }
        }), "reminderTimes");
        await ExpectFieldError(await user.Post("/api/habits", new
        {
            name = "Water",
            frequency = "daily",
            timesPerDay = 3,
            reminderTimes = new[] { "08:00", "08:00" }
        }), "reminderTimes");
        await ExpectFieldError(await user.Post("/api/habits", new
        {
            name = "Water",
            frequency = "daily",
            timesPerDay = 3,
            reminderTimes = new[] { "8am" }
        }), "reminderTimes");
        await ExpectFieldError(await user.Post("/api/habits", new
        {
            name = "Read",
            frequency = "weekly",
            reminderTimes = new[] { "08:00", "20:00" }
        }), "reminderTimes");
        (await Host.Db(db => db.Habits.CountAsync(h => h.User.Email == user.Email))).Should().Be(0);

        var created = await (await user.Post("/api/habits", new
        {
            name = "Water",
            frequency = "daily",
            timesPerDay = 3,
            reminderTime = "06:00",
            reminderTimes = new[] { "20:00", "08:00", "13:00" }
        })).ExpectJson(HttpStatusCode.Created);

        Times(created).Should().Equal("08:00", "13:00", "20:00");
        created.GetProperty("reminderTime").GetString().Should().Be("08:00");
        var id = created.GetProperty("id").GetInt32();
        (await Host.Db(db => db.Habits.Where(h => h.Id == id).Select(h => h.ReminderTimes).SingleAsync()))
            .Should().Equal(new TimeOnly(8, 0), new TimeOnly(13, 0), new TimeOnly(20, 0));
    }

    [DockerFact]
    public async Task Clients_that_send_only_reminder_time_set_and_replace_a_single_time()
    {
        var user = await Host.SignedInAsync();
        var created = await (await user.Post("/api/habits", new { name = "Water", frequency = "daily", timesPerDay = 3, reminderTime = "09:00" }))
            .ExpectJson(HttpStatusCode.Created);
        Times(created).Should().Equal("09:00");
        var id = created.GetProperty("id").GetInt32();

        await (await user.Patch($"/api/habits/{id}", new { reminderTimes = new[] { "08:00", "20:00" } })).ExpectJson();
        var single = await (await user.Patch($"/api/habits/{id}", new { reminderTime = "07:15" })).ExpectJson();

        Times(single).Should().Equal("07:15");
        single.GetProperty("reminderTime").GetString().Should().Be("07:15");

        var cleared = await (await user.Patch($"/api/habits/{id}", new { reminderTimes = Array.Empty<string>() })).ExpectJson();
        Times(cleared).Should().BeEmpty();
        cleared.GetProperty("reminderTime").ValueKind.Should().Be(JsonValueKind.Null);
        (await Host.Db(db => db.Habits.Where(h => h.Id == id).Select(h => h.NextReminderUtc).SingleAsync())).Should().BeNull();
    }

    [DockerFact]
    public async Task Patch_checks_times_against_the_new_times_per_day_and_lowering_it_keeps_the_earliest_times()
    {
        var user = await Host.SignedInAsync();
        var id = (await (await user.Post("/api/habits", new { name = "Water", frequency = "daily", timesPerDay = 1, reminderTime = "09:00" }))
            .ExpectJson(HttpStatusCode.Created)).GetProperty("id").GetInt32();

        await ExpectFieldError(await user.Patch($"/api/habits/{id}", new { reminderTimes = new[] { "08:00", "20:00" } }), "reminderTimes");
        await ExpectFieldError(await user.Patch($"/api/habits/{id}", new { reminderTimes = new[] { "08:00" }, clearReminder = true }), "reminderTimes");
        var raised = await (await user.Patch($"/api/habits/{id}", new { timesPerDay = 3, reminderTimes = new[] { "20:00", "08:00", "13:00" } }))
            .ExpectJson();
        Times(raised).Should().Equal("08:00", "13:00", "20:00");

        var lowered = await (await user.Patch($"/api/habits/{id}", new { timesPerDay = 2 })).ExpectJson();

        Times(lowered).Should().Equal("08:00", "13:00");
        Times(await (await user.Patch($"/api/habits/{id}", new { frequency = "weekly" })).ExpectJson()).Should().Equal("08:00");
    }

    [DockerFact]
    public async Task Create_takes_reminder_channels_with_the_patch_validation()
    {
        var user = await Host.SignedInAsync();

        await ExpectFieldError(await user.Post("/api/habits", new { name = "Water", frequency = "daily", reminderChannels = new[] { "sms" } }),
            "reminderChannels");
        var created = await (await user.Post("/api/habits", new { name = "Water", frequency = "daily", reminderChannels = new[] { "mobile" } }))
            .ExpectJson(HttpStatusCode.Created);

        created.GetProperty("reminderChannels").EnumerateArray().Select(c => c.GetString()).Should().Equal("mobile");
        var id = created.GetProperty("id").GetInt32();
        (await Host.Db(db => db.Habits.Where(h => h.Id == id).Select(h => h.ReminderChannels).SingleAsync())).Should().Be(ReminderChannels.Mobile);
    }
}
